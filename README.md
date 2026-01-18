# BasketStat Trends

A lightweight dashboard for coaches to upload game CSVs, track player stats over time, and surface quick trend insights.

## Pages
- **Dashboard:** `index.html`
- **Admin Upload:** `admin.html`

## CSV format
Each game CSV should include a `player` column plus any number of stat columns.
Example:

```csv
player,PTS,REB,AST
Jordan,28,6,4
Sam,12,10,2
```

In the Admin page, you will still provide the game date and opponent.

## Local usage
Open `index.html` in a browser, or run a static server:

```bash
npx serve .
```

## Deployment
The included GitHub Actions workflow publishes the site to GitHub Pages on every push to `main`.
