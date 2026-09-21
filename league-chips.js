/**
 * league-chips.js
 *
 * Shared toggle-chip multi-league picker used by the Dashboard, Player
 * Comparison and Team Builder views. Replaces the old native <select>
 * controls with discoverable chips: an "All" chip plus one chip per league.
 *
 * Selection semantics: an EMPTY selection means "All" (no filter), matching
 * the existing filter code across the app (`selected.length === 0 ? all : ...`).
 *
 * Usage:
 *   const ctrl = window.leagueChips.mount({
 *     container: document.getElementById('leagueFilter'),
 *     leagues: ['A', 'B'],        // optional initial leagues
 *     selected: [],               // optional initial selection
 *     onChange: (selected) => {}  // called after every user toggle
 *   });
 *   ctrl.getSelected();           // -> string[] ([] means All)
 *   ctrl.setLeagues(['A','B','C']); // repopulate, preserving valid selections
 */
(function () {
  const ALL_LABEL = 'All';

  const mount = ({ container, leagues = [], selected = [], onChange } = {}) => {
    if (!container) {
      throw new Error('leagueChips.mount: container is required');
    }

    // Internal state: array of currently selected league names ([] == All).
    let allLeagues = [];
    let selectedSet = new Set();

    const notify = () => {
      if (typeof onChange === 'function') onChange(getSelected());
    };

    const getSelected = () => Array.from(selectedSet);

    const render = () => {
      container.classList.add('league-chips');
      container.innerHTML = '';

      const allActive = selectedSet.size === 0;
      const allChip = document.createElement('button');
      allChip.type = 'button';
      allChip.className = 'league-chip' + (allActive ? ' active' : '');
      allChip.textContent = ALL_LABEL;
      allChip.setAttribute('aria-pressed', String(allActive));
      allChip.addEventListener('click', () => {
        if (selectedSet.size === 0) return; // already All, no-op
        selectedSet.clear();
        render();
        notify();
      });
      container.appendChild(allChip);

      allLeagues.forEach((league) => {
        const active = selectedSet.has(league);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'league-chip' + (active ? ' active' : '');
        chip.textContent = league;
        chip.setAttribute('aria-pressed', String(active));
        chip.addEventListener('click', () => {
          if (selectedSet.has(league)) selectedSet.delete(league);
          else selectedSet.add(league);
          // Empty selection naturally falls back to "All".
          render();
          notify();
        });
        container.appendChild(chip);
      });
    };

    const setLeagues = (nextLeagues) => {
      allLeagues = Array.from(
        new Set((nextLeagues || []).map((l) => (l || '').trim()).filter(Boolean))
      ).sort();
      // Drop any previously-selected leagues that no longer exist.
      selectedSet = new Set(Array.from(selectedSet).filter((l) => allLeagues.includes(l)));
      render();
    };

    // Initial population.
    setLeagues(leagues);
    if (Array.isArray(selected) && selected.length) {
      selectedSet = new Set(selected.filter((l) => allLeagues.includes(l)));
      render();
    }

    return { getSelected, setLeagues };
  };

  window.leagueChips = { mount };
})();
