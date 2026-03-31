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
    const fetchNews = async () => {
      try {
        const response = await fetch('/news.json');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setNews(data.news || []);
        setLastUpdate(data.lastUpdate);
      } catch (error) {
        console.error('Error fetching news:', error);
        setNews([]);
      }
    };

    fetchNews();
  }, []);

  useEffect(() => {
    localStorage.setItem('viewedNews', JSON.stringify(viewedNews));
  }, [viewedNews]);

  const isNew = (newsId) => !viewedNews.includes(newsId);

  const handleNewsClick = (newsId) => {
    if (!viewedNews.includes(newsId)) {
      setViewedNews([...viewedNews, newsId]);
    }
  };

  const formatDateFr = (dateString) => {
    const date = new Date(dateString);
    const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    return `${day} ${month}`;
  };

  const formatHeaderTimestamp = (dateString) => {
    const date = new Date(dateString);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    const dayName = days[date.getDay()];
    const dayNum = date.getDate();
    const monthName = months[date.getMonth()];
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${dayName} ${dayNum}th of ${monthName} ${year} at ${hours}:${minutes} CEST`;
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Claude AI News</h1>
        {lastUpdate && (
          <p className="last-update">Last updated: {formatHeaderTimestamp(lastUpdate)}</p>
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
              <p className="news-date">{formatDateFr(item.date)}</p>
              <span className={`tag tag-${item.tag.toLowerCase().replace(/\s+/g, '')}`}>
                <span className="tag-dot"></span>
                {item.tag}
              </span>
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleNewsClick(item.id)}
              >
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
