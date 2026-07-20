import { useEffect, useState } from "react";
import AdminLayout from "../layouts/AdminLayout";
import { api } from "../api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ total_fund: 0, total_expenses: 0, balance: 0, pending_count: 0 });
  const [monthlyStats, setMonthlyStats] = useState([]);
  const user = JSON.parse(localStorage.getItem("user"));

  const loadData = async () => {
    try {
      const [summaryRes, statsRes] = await Promise.all([
        api.get("/get-summary"),
        api.get("/admin/monthly-expenses-stats")
      ]);
      setSummary(summaryRes.data);
      setMonthlyStats(statsRes.data);
    } catch (err) {
      console.log("Error loading dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  };

  if (loading) {
    return (
      <AdminLayout>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
          <p style={{ color: "var(--slate)", fontSize: "1rem" }}>Loading dashboard...</p>
        </div>
      </AdminLayout>
    );
  }

  const cards = [
    { label: "Total Funds", value: `₹${summary.total_fund}`, accent: "teal", icon: "💎", sub: "Total money added" },
    { label: "Total Expense", value: `₹${summary.total_submitted_amount || 0}`, accent: "indigo", icon: "📋", sub: "Pending + Disbursed" },
    { label: "Disbursed Expense", value: `₹${summary.total_expenses}`, accent: "rose", icon: "📤", sub: `${summary.total_expenses_count || 0} approved records` },
    { label: "Available Balance", value: `₹${summary.balance}`, accent: "green", icon: "🏦", sub: "Remaining funds" },
  ];

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <AdminLayout>
      <div className="animate-in dashboard-container">
        <div className="premium-header">
          <h1>{getGreeting()}, {user?.name || 'Admin'}!</h1>
          <p>Overview of all financial activities and team expenses</p>
        </div>

        {/* Summary Cards */}
        <div className="stats-grid">
          {cards.map((c, i) => (
            <div key={i} className={`card glass-card hover-lift card-accent-${c.accent}`} style={{ padding: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--slate)", textTransform: "uppercase", letterSpacing: "0.8px" }}>{c.label}</p>
                <div style={{ background: `var(--${c.accent}-light)`, padding: '8px', borderRadius: '10px', fontSize: '1.2rem' }}>{c.icon}</div>
              </div>
              <p style={{ fontSize: "2rem", fontWeight: 800, color: `var(--${c.accent})`, letterSpacing: '-1px' }}>{c.value}</p>
              {c.sub && <p style={{ fontSize: "0.75rem", color: "var(--slate-light)", marginTop: "8px", fontWeight: 500 }}>{c.sub}</p>}
            </div>
          ))}
        </div>

        <div style={{ marginTop: '40px' }}></div>

        {/* Bar Chart section */}
        <div className="chart-container animate-in" style={{ animationDelay: '0.1s' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--navy)" }}>📊 Month-wise Total Expenses</h2>
            <div style={{ fontSize: '0.8rem', color: 'var(--slate)', fontWeight: 500 }}>Total Submitted Amount</div>
          </div>

          <div style={{ width: '100%', height: 350 }}>
            {monthlyStats.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyStats} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 13, fontWeight: 500 }}
                    dy={15}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: '#f8fafc', radius: 10 }}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', padding: '12px' }}
                    formatter={(value) => [`₹${value}`, 'Total Expense']}
                  />
                  <Bar dataKey="total_expense" radius={[10, 10, 0, 0]} barSize={45}>
                    {monthlyStats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--slate)" }}>
                <span style={{ fontSize: '3rem', marginBottom: '16px' }}>📉</span>
                <p>No expense data available yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Quick Info */}
        <div className="card glass-card" style={{ padding: "24px", marginTop: "32px", borderLeft: '4px solid var(--indigo)' }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--navy)", marginBottom: "12px" }}>✨ System Status</h2>
          <p style={{ color: "var(--slate)", fontSize: "0.95rem", lineHeight: 1.6 }}>
            The financial system is <strong style={{ color: "var(--green)" }}>fully synchronized</strong>.
            There are <strong style={{ color: "var(--amber)" }}>{summary.pending_count}</strong> pending requests awaiting your review.
          </p>
        </div>
      </div>
    </AdminLayout>
  );
}

export default AdminDashboard;
