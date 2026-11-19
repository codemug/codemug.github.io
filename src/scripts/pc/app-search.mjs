// Search titles, descriptions and synonyms, requiring every entered word.
export function filterApps(apps, query = '', category = 'all') {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return apps.filter(app => {
    if (category !== 'all' && app.category !== category) return false;
    const text = [app.title, app.description, app.category, ...(app.keywords ?? [])].join(' ').toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}
