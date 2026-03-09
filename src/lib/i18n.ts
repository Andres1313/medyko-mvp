const dictionary = {
  appName: 'Medyko Guatemala',
  searchPlaceholder: 'Busca clínicas o quirófanos por zona, equipo o precio',
}

export function t(key: keyof typeof dictionary): string {
  return dictionary[key]
}
