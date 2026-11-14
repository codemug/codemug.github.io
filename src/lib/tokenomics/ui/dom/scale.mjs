// The chart scale switch (Logarithmic or Linear): two radio inputs in one
// radiogroup, already in the page (Calculator.astro). It is never rebuilt, so the
// focus stays on it while the charts redraw. Arrow keys move between the two.

export function mountScaleToggle(root, onChange) {
  const group = root.querySelector('#tk-scale');
  const radios = [...group.querySelectorAll('input[type="radio"]')];
  group.addEventListener('change', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.checked) onChange(e.target.value === 'linear' ? 'linear' : 'log');
  });
  return {
    update(scale) {
      for (const r of radios) r.checked = r.value === scale;
    },
  };
}
