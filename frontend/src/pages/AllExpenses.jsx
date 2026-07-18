import { useEffect, useState } from "react";
import AdminLayout from "../layouts/AdminLayout";
import { api } from "../api";

function AllExpenses() {
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [filteredExpenses, setFilteredExpenses] = useState([]);
  const [filterName, setFilterName] = useState("");
  const [message, setMessage] = useState("");

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editExpense, setEditExpense] = useState(null);
  const [editForm, setEditForm] = useState({ description: "", amount: "", date: "", payment_method: "Cash" });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState(null);

  const loadExpenses = async () => {
    try {
      const res = await api.get("/admin/get-all-expenses");
      const sorted = (res.data.expenses || []).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      setExpenses(sorted);
      setFilteredExpenses(sorted);
    } catch (err) {
      console.log("Error fetching expenses", err);
      if (err.response?.status === 401) { setMessage("Session expired."); localStorage.clear(); window.location.href = "/login"; }
      else setMessage("Failed to fetch expenses");
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = (val) => {
    setFilterName(val);
    if (!val.trim()) { setFilteredExpenses(expenses); return; }
    setFilteredExpenses(expenses.filter((e) => e.employee_name?.toLowerCase().includes(val.toLowerCase())));
  };

  const handleExport = () => {
    const token = localStorage.getItem("session");
    if (!token) { setMessage("Session expired."); return; }
    window.open(`${import.meta.env.VITE_API_URL}/admin/export-expenses-excel?session_token=${token}`, "_blank");
  };

  const handleDisburse = async (id) => {
    if (!window.confirm("Disburse this expense?")) return;
    try {
      const res = await api.post("/admin/disburse-expense", { expense_id: id });
      setMessage(res.data.message);
      loadExpenses();
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to disburse");
    }
  };

  const openEditModal = (exp) => {
    setEditExpense(exp);
    setEditForm({ description: exp.description, amount: exp.amount, date: exp.date, payment_method: exp.payment_method || "Cash" });
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/update-expense/${editExpense.id}`, editForm);
      setMessage("Expense updated successfully");
      setEditModalOpen(false);
      loadExpenses();
    } catch (err) {
      setMessage(err.response?.data?.error || "Update failed");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this expense?")) return;
    try {
      await api.delete(`/delete-expense/${id}`, { data: { session_token: localStorage.getItem("session") } });
      setMessage("Expense deleted");
      loadExpenses();
    } catch (err) {
      setMessage(err.response?.data?.error || "Delete failed");
    }
  };

  useEffect(() => { loadExpenses(); }, []);

  if (loading) {
    return (
      <AdminLayout>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
          <p style={{ color: "var(--slate)" }}>Loading expenses...</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {/* Edit Modal */}
      {editModalOpen && (
        <div className="modal-overlay" onClick={() => setEditModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ fontSize: "1.15rem", fontWeight: 600, color: "var(--navy)" }}>Edit Expense</h3>
              <button onClick={() => setEditModalOpen(false)} style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", color: "var(--slate)" }}>✕</button>
            </div>
            <form onSubmit={handleEditSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="input" placeholder="Description" />
              <input type="number" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} className="input" placeholder="Amount" />
              <input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} className="input" />
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "0.82rem", fontWeight: 500, color: "var(--navy-light)" }}>Payment Method</label>
                <select value={editForm.payment_method} onChange={(e) => setEditForm({ ...editForm, payment_method: e.target.value })} className="input" required>
                  <option value="Cash">Cash</option>
                  <option value="Online">Online</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>Save Changes</button>
            </form>
          </div>
        </div>
      )}

      {/* Bill Preview Modal */}
      {previewOpen && previewData && (
        <div className="modal-overlay" onClick={() => setPreviewOpen(false)}>
          <div style={{ background: "#fff", borderRadius: "16px", padding: "16px", maxWidth: "90vw", maxHeight: "90vh", overflow: "auto", animation: "slideUp 0.2s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: "right", marginBottom: "8px" }}>
              <button onClick={() => setPreviewOpen(false)} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "var(--slate)" }}>✕</button>
            </div>
            {previewData.startsWith("data:application/pdf") ? (
              <iframe src={previewData} title="PDF Preview" style={{ width: "80vw", height: "80vh", border: "none", borderRadius: "8px" }} />
            ) : (
              <img src={previewData} alt="Bill" style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: "8px" }} />
            )}
          </div>
        </div>
      )}

      <div className="animate-in">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--navy)", marginBottom: "4px" }}>All Expenses</h1>
        <p style={{ color: "var(--slate)", fontSize: "0.875rem", marginBottom: "20px" }}>View, filter, disburse, edit, or delete expenses</p>

        {message && (
          <div className="card" style={{ padding: "12px 16px", marginBottom: "16px", borderLeft: "4px solid var(--teal)" }}>
            <p style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--navy)" }}>{message}</p>
          </div>
        )}

        {/* Search + Export */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="🔍 Search by employee name..."
            value={filterName}
            onChange={(e) => handleFilter(e.target.value)}
            className="input"
            style={{ maxWidth: "320px", flex: 1 }}
          />
          <button onClick={handleExport} className="btn btn-indigo btn-sm">📥 Export Excel</button>
        </div>

        {/* Table */}
        <div className="card" style={{ padding: "4px" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="clean-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Description</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Payment Method</th>
                  <th>Bill</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.length > 0 ? (
                  filteredExpenses.map((exp) => (
                    <tr key={exp.id}>
                      <td style={{ fontWeight: 500 }}>{exp.employee_name}</td>
                      <td>{exp.description}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{exp.date}</td>
                      <td style={{ fontWeight: 600 }}>₹{exp.amount}</td>
                      <td>{exp.payment_method || "Cash"}</td>
                      <td>
                        {exp.bill_image ? (
                          exp.bill_image.startsWith("data:application/pdf") ? (
                            <button onClick={() => { setPreviewData(exp.bill_image); setPreviewOpen(true); }} className="btn btn-outline btn-sm">📄 PDF</button>
                          ) : (
                            <img
                              src={exp.bill_image}
                              alt="Bill"
                              style={{ width: "44px", height: "44px", objectFit: "cover", borderRadius: "6px", cursor: "pointer", border: "1px solid var(--border)" }}
                              onClick={() => { setPreviewData(exp.bill_image); setPreviewOpen(true); }}
                            />
                          )
                        ) : "—"}
                      </td>
                      <td>
                        <span className={`badge ${exp.status === "disbursed" ? "badge-disbursed" : "badge-pending"}`}>
                          {exp.status === "disbursed" ? "Disbursed" : "Pending"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {exp.status !== "disbursed" && (
                            <>
                              <button onClick={() => handleDisburse(exp.id)} className="btn btn-green btn-sm">Disburse</button>
                              <button onClick={() => openEditModal(exp)} className="btn btn-amber btn-sm">Edit</button>
                            </>
                          )}
                          <button onClick={() => handleDelete(exp.id)} className="btn btn-rose btn-sm">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="8" style={{ textAlign: "center", padding: "32px", color: "var(--slate)" }}>No expenses found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

export default AllExpenses;
