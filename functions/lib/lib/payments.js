"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePricing = computePricing;
exports.createRecurrenteCheckout = createRecurrenteCheckout;
function computePricing(baseRent) {
    const platformFee = Number((baseRent * 0.1).toFixed(2));
    const processingFee = Number((baseRent * 0.045 + 2).toFixed(2));
    const total = Number((baseRent + platformFee + processingFee).toFixed(2));
    return { baseRent, platformFee, processingFee, total };
}
async function createRecurrenteCheckout(input) {
    const publicKey = process.env.RECURRENTE_PUBLIC_KEY;
    const secretKey = process.env.RECURRENTE_SECRET_KEY;
    const endpoint = process.env.RECURRENTE_API_URL;
    if (!publicKey || !secretKey || !endpoint) {
        throw new Error('Recurrente env vars missing');
    }
    const response = await fetch(`${endpoint}/checkouts`, {
        method: 'POST',
        headers: {
            'X-PUBLIC-KEY': publicKey,
            'X-SECRET-KEY': secretKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            items: [
                {
                    name: input.description,
                    currency: 'GTQ',
                    amount_in_cents: Math.round(input.amount * 100),
                    quantity: 1,
                },
            ],
            metadata: {
                bookingId: input.bookingId,
                clinicId: input.clinicId,
            },
        }),
    });
    if (!response.ok) {
        throw new Error(`Recurrente error ${response.status}`);
    }
    const data = (await response.json());
    return { checkoutId: data.id, checkoutUrl: data.checkout_url };
}
