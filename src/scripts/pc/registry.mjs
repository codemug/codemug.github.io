// Add only working app routes. External tools must announce their new-tab behavior.
export const apps = [
  { id: 'sheets', title: 'Sheets', category: 'Office', keywords: ['spreadsheet', 'excel', 'xlsx', 'calculate'], description: 'A spreadsheet for your browser.', src: '/pc/apps/sheets/', kind: 'iframe', loadTimeout: 45000, width: 1040, height: 640 },
  { id: 'docs', title: 'Docs', category: 'Office', keywords: ['document', 'write', 'word'], description: 'Write and format documents.', src: '/pc/apps/docs/', kind: 'iframe', loadTimeout: 45000, width: 1040, height: 680 },
  { id: 'slides', title: 'Slides', category: 'Office', keywords: ['presentation', 'deck'], description: 'Create and present slide decks.', src: '/pc/apps/slides/', kind: 'iframe', loadTimeout: 45000, width: 1100, height: 680 },
  { id: 'terminal', title: 'Terminal', category: 'Developer', keywords: ['linux', 'alpine', 'bash', 'python', 'node', 'shell'], description: 'Real offline Linux with Bash, Python and Node.js.', src: '/pc/apps/terminal/', kind: 'iframe', width: 940, height: 680 },
  { id: 'cyberchef', title: 'CyberChef', category: 'Utilities', keywords: ['encode', 'decode', 'hash', 'base64', 'convert'], description: 'Encode, decode, and transform data.', src: '/pc/apps/cyberchef/', kind: 'iframe', loadTimeout: 55000, width: 1180, height: 720 },
  { id: 'vscode', title: 'VS Code ↗', category: 'Developer', keywords: ['code', 'editor', 'vscode'], description: 'vscode.dev — opens in a new tab.', src: 'https://vscode.dev/', kind: 'external' },
  { id: 'ai-agent', title: 'AI Agent', category: 'Utilities', keywords: ['ai', 'chat', 'assistant', 'local', 'model'], description: 'A private text workspace with an on-device model.', src: '/pc/apps/ai-agent/', kind: 'iframe', width: 1000, height: 740 },
  { id: 'lightcraft', title: 'LightCraft', category: 'Creative', keywords: ['photos', 'raw', 'image'], description: 'Develop and edit photos.', src: '/pc/apps/lightcraft/', kind: 'iframe', loadTimeout: 75000, width: 1180, height: 760 },
  { id: 'figcraft', title: 'FigCraft', category: 'Creative', keywords: ['design', 'vector', 'graphics'], description: 'Create vector designs.', src: '/pc/apps/figcraft/', kind: 'iframe', loadTimeout: 75000, width: 1180, height: 760 },
  { id: 'pdfcraft', title: 'PDFCraft', category: 'Office', keywords: ['pdf', 'annotate', 'document'], description: 'Read and annotate PDF files.', src: '/pc/apps/pdfcraft/', kind: 'iframe', loadTimeout: 75000, width: 1180, height: 760 },
  { id: 'soundcraft', title: 'SoundCraft', category: 'Creative', keywords: ['audio', 'music', 'sound'], description: 'Work with audio in your browser.', src: '/pc/apps/soundcraft/', kind: 'iframe', loadTimeout: 75000, width: 1180, height: 760 },
  { id: 'filmcraft', title: 'FilmCraft', category: 'Creative', keywords: ['video', 'film', 'edit', 'timeline', 'audio'], description: 'Edit video, audio and stills into films.', src: '/pc/apps/filmcraft/', kind: 'iframe', loadTimeout: 75000, width: 1280, height: 800 },
  { id: 'vert', title: 'VERT', category: 'Utilities', keywords: ['convert', 'converter', 'image', 'audio', 'document', 'video'], description: 'Convert files locally with VERT.', src: '/pc/apps/vert/', kind: 'iframe', loadTimeout: 95000, width: 1180, height: 800 },
  { id: 'about', title: 'About WebPC', category: 'System', keywords: ['help', 'controls', 'keyboard', 'save'], description: 'Controls, shortcuts, and local saves.', kind: 'about', width: 520, height: 560 },
];
export const categories = [...new Set(apps.map(app => app.category))];
