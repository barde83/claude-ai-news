# Claude AI News

A minimal news site for Claude AI updates, scraping from official sources.

## Sources
- Twitter: @claudeai
- Twitter: @daioamodei
- Anthropic Blog: https://docs.anthropic.com/en/release-notes/claude-apps

## Tech Stack
- **Frontend:** React + Vite
- **Backend:** Netlify Functions (Node.js scraper)
- **Scheduling:** GitHub Actions (every 48 hours at 6 AM)
- **Hosting:** Netlify

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Create GitHub Repository
```bash
# Create a new public repo on GitHub
# Name it: claude-ai-news
# Then run:
git remote add origin https://github.com/YOUR_USERNAME/claude-ai-news.git
git branch -M main
git push -u origin main
```

### 3. Deploy to Netlify
- Go to https://app.netlify.com
- Click "Add new site" → "Import an existing project"
- Connect your GitHub repo
- Netlify will auto-detect the build config from `netlify.toml`
- Deploy!

## Development

```bash
npm run dev
```

Visit `http://localhost:3000`

## Project Structure
```
.
├── src/
│   ├── App.jsx       # Main component
│   ├── App.css       # Styling (gray noise background)
│   ├── main.jsx
│   └── index.css
├── functions/
│   └── scrape.js     # Netlify Function (to be implemented)
├── .github/workflows/
│   └── scrape.yml    # GitHub Actions scheduler (every 48h)
├── public/
│   └── news.json     # Cached news data
└── netlify.toml      # Netlify config
```

## To Do

### Backend (sephirot-backend-agent)
- [ ] Implement Twitter scraping (@claudeai, @daioamodei)
- [ ] Implement Anthropic blog scraping
- [ ] Auto-tag generation (Code, Cowork, Misc)
- [ ] Store results in `public/news.json`
- [ ] Add error handling + logging

### Frontend (jaskier-frontend-agent)
- [ ] Fetch news from `public/news.json`
- [ ] Display last update timestamp
- [ ] Show "New" badge for unseen news (localStorage)
- [ ] Responsive design polish

### DevOps
- [ ] Test GitHub Actions scheduler
- [ ] Verify Netlify Function execution
- [ ] Monitor scraper errors

## Security Notes
- All sources are highly trusted (official Claude/Anthropic accounts)
- XSS risk: minimal (trusted sources)
- Scraping frequency: 48h (reduces rate limiting)
- No sensitive data stored

See `/Notion: Claude AI News Mini Site` for full project tracking.
