import { useEffect, useState } from 'react';
import './App.css';

function App() {
  const [news, setNews] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [viewedNews, setViewedNews] = useState(() => {
    const stored = localStorage.getItem('viewedNews');
    return stored ? JSON.parse(stored) : [];
  });

  useEffect(() => {
    // TODO: Fetch news from news.json
    // For now, placeholder
    console.log('Fetching news...');
  }, []);

  useEffect(() => {
    localStorage.setItem('viewedNews', JSON.stringify(viewedNews));
  }, [viewedNews]);

  const isNew = (newsId) => !viewedNews.includes(newsId);

  return (
    <div className="app">
      <header className="header">
        <h1>Claude AI News</h1>
        {lastUpdate && (
          <p className="last-update">Last updated: {new Date(lastUpdate).toLocaleString()}</p>
        )}
      </header>

      <main className="news-grid">
        {news.length === 0 ? (
          <p>Loading news...</p>
        ) : (
          news.map((item) => (
            <article key={item.id} className="news-card">
              {isNew(item.id) && <span className="badge-new">New</span>}
              <h3>{item.title}</h3>
              <p className="news-date">{new Date(item.date).toLocaleDateString()}</p>
              <span className="tag">{item.tag}</span>
              <a href={item.link} target="_blank" rel="noopener noreferrer">
                View source →
              </a>
            </article>
          ))
        )}
      </main>
    </div>
  );
}

export default App;
