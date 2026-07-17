import { useEffect, useState } from "react";
import AdminLayout from "../layouts/AdminLayout";
import { api } from "../api";

function FundHistory() {
  const [funds, setFunds] = useState([]);
  const [summary, setSummary] = useState({ total_fund: 0, total_expenses: 0, balance: 0 });
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [fundData, summaryData] = await Promise.all([
        api.get("/get-all-funds"),
        api.get("/get-summary"),
      ]);
      setFunds(fundData.data.funds || []);
      setSummary(summaryData.data);
    } catch (err) {
      console.log("Error loading fund history", err);
      if (err.response?.status === 401) { localStorage.clear(); window.location.href = "/login"; }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  if (loading) {
    return (
      <AdminLayout>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
          <p style={{ color: "var(--slate)" }}>Loading fund history...</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="animate-in">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--navy)", marginBottom: "4px" }}>Fund Dashboard</h1>
        <p style={{ color: "var(--slate)", fontSize: "0.875rem", marginBottom: "24px" }}>Fund history and balance overview</p>

        {/* Summary Badges */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "24px" }}>
          <div className="card" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--slate)" }}>Total Fund:</span>
            <span style={{ fontSize: "1rem", fontWeight: 700, color: "var(--teal)" }}>₹{summary.total_fund}</span>
          </div>
          <div className="card" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--slate)" }}>Disbursed:</span>
            <span style={{ fontSize: "1rem", fontWeight: 700, color: "var(--rose)" }}>₹{summary.total_expenses}</span>
          </div>
          <div className="card" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--slate)" }}>Balance:</span>
            <span style={{ fontSize: "1rem", fontWeight: 700, color: "var(--green)" }}>₹{summary.balance}</span>
          </div>
        </div>

        {/* Table */}
        <div className="card" style={{ padding: "4px" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="clean-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Description</th>
                  <th>Added By</th>
                </tr>
              </thead>
              <tbody>
                {funds.length > 0 ? (
                  funds.map((f) => (
                    <tr key={f.id}>
                      <td>{f.date}</td>
                      <td style={{ fontWeight: 600, color: "var(--teal)" }}>₹{f.amount}</td>
                      <td>
                        <span className={`badge ${f.payment_method?.toLowerCase() === "online" ? "badge-online" : "badge-cash"}`}>
                          {f.payment_method || "Cash"}
                        </span>
                      </td>
                      <td>{f.description || "—"}</td>
                      <td>{f.admin_name}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="5" style={{ textAlign: "center", padding: "32px", color: "var(--slate)" }}>No funds found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

export default FundHistory;
