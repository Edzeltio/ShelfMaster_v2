import React, { useState, useEffect } from 'react';
import { localDb } from './localDbClient';
import { localDbAdmin } from './localDbAdmin';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';

export default function LibrarianDashboard() {
  const [stats, setStats] = useState({ totalBooks: 0, activeLoans: 0, pending: 0, totalBorrowed: 0 });
  const [chartData, setChartData] = useState([]);
  const [topBooks, setTopBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);

  useEffect(() => {
    fetchDashboardData();

    const channel = localDb
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, fetchDashboardData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'books' }, fetchDashboardData)
      .subscribe();

    return () => localDb.removeChannel(channel);
  }, []);

  async function fetchDashboardData() {
    setLoading(true);
    setStatsError(null);

    const [
      { count: books, error: booksErr },
      { count: loans, error: loansErr },
      { count: pending, error: pendingErr },
      { count: totalBorrowed, error: borrowedErr },
    ] = await Promise.all([
      localDbAdmin.from('books').select('*', { count: 'exact', head: true }).neq('status', 'archived'),
      localDbAdmin.from('transactions').select('*', { count: 'exact', head: true }).eq('status', 'borrowed'),
      localDbAdmin.from('transactions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      localDbAdmin.from('transactions').select('*', { count: 'exact', head: true }).in('status', ['borrowed', 'returned']),
    ]);

    const anyError = booksErr || loansErr || pendingErr || borrowedErr;
    if (anyError) {
      setStatsError('Some stats could not be loaded. Check your database permissions.');
    }

    setStats({
      totalBooks: books ?? 0,
      activeLoans: loans ?? 0,
      pending: pending ?? 0,
      totalBorrowed: totalBorrowed ?? 0,
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: transactions } = await localDbAdmin
      .from('transactions')
      .select('borrow_date')
      .gte('borrow_date', sevenDaysAgo.toISOString());

    const dateMap = {};
    for(let i=6; i>=0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dateMap[d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })] = 0;
    }

    transactions?.forEach(t => {
      const dateLabel = new Date(t.borrow_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (dateMap[dateLabel] !== undefined) dateMap[dateLabel]++;
    });

    setChartData(Object.keys(dateMap).map(key => ({ date: key, loans: dateMap[key] })));

    const { data: topData } = await localDbAdmin
      .from('transactions')
      .select('book_id, books(title, authors)')
      .limit(20);

    const counts = {};
    topData?.forEach(t => {
      const title = t.books?.title || "Unknown";
      counts[title] = (counts[title] || 0) + 1;
    });
    
    const sortedBooks = Object.keys(counts)
      .map(title => ({ title, count: counts[title] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    setTopBooks(sortedBooks);
    setLoading(false);
  }

  return (
    <div style={{ padding: '20px' }}>
      <header style={{ marginBottom: '30px' }}>
        <h1 style={{ color: 'var(--maroon)', margin: 0 }}>Librarian Dashboard</h1>
        <p style={{ color: '#64748b' }}>Welcome back! Here is what's happening in your library today.</p>
      </header>

      {/* STATS ERROR BANNER */}
      {statsError && (
        <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '10px', padding: '12px 18px', marginBottom: '20px', color: '#856404', fontSize: '0.9rem' }}>
          ⚠️ {statsError}
        </div>
      )}

      {/* STATS CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <StatCard title="Total Collection" value={stats.totalBooks} color="var(--maroon)" icon="📚" />
        <StatCard title="Active Loans" value={stats.activeLoans} color="var(--green)" icon="📖" />
        <StatCard title="Pending Requests" value={stats.pending} color="var(--yellow)" icon="⏳" />
        <StatCard title="Books Borrowed" value={stats.totalBorrowed} color="#6366f1" icon="🎓" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        
        {/* CHART SECTION */}
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 20px 0', color: 'var(--maroon)' }}>Monthly Circulation Trends</h3>
          <div style={{ width: '100%', height: 300, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorLoans" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7DB356" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#7DB356" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Area type="monotone" dataKey="loans" stroke="#7DB356" strokeWidth={3} fillOpacity={1} fill="url(#colorLoans)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* TOP BOOKS SECTION */}
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 20px 0', color: 'var(--maroon)' }}>Most Popular Books</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {topBooks.length > 0 ? topBooks.map((book, i) => (
              <li key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < 4 ? '1px solid #f1f5f9' : 'none' }}>
                <span style={{ fontSize: '0.9rem', color: '#334155', fontWeight: '500' }}>{book.title}</span>
                <span style={{ fontSize: '0.8rem', background: '#F5FAE8', color: 'var(--green)', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
                  {book.count}x
                </span>
              </li>
            )) : <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No data available yet.</p>}
          </ul>
        </div>

      </div>
    </div>
  );
}

const cardStyle = {
  background: 'white',
  padding: '25px',
  borderRadius: '15px',
  boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
  border: '1px solid #e2e8f0'
};

function StatCard({ title, value, color, icon }) {
  return (
    <div style={{ background: 'white', padding: '25px', borderRadius: '15px', borderLeft: `6px solid ${color}`, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '16px' }}>
      {icon && (
        <div style={{ fontSize: '2rem', lineHeight: 1 }}>{icon}</div>
      )}
      <div>
        <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 'bold', letterSpacing: '0.5px' }}>{title}</div>
        <div style={{ fontSize: '2.2rem', fontWeight: 'bold', color: '#1e293b', marginTop: '6px' }}>{value}</div>
      </div>
    </div>
  );
}
