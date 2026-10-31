// Shiki transformer for Astro's <Code /> component: adds a class to the given 1-based lines so CSS can highlight them.
// Used by the Part 4 post to show a manifest with the lines that changed marked.
export const hl = (lines) => [
  {
    line(node, line) {
      if (lines.includes(line)) this.addClassToHast(node, 'line-hl');
    },
  },
];
