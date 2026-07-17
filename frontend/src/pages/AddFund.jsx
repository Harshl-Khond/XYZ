import { useState } from "react";
import AdminLayout from "../layouts/AdminLayout";
import { api } from "../api";

function AddFund() {
  const admin = JSON.parse(localStorage.getItem("user"));
  const admin_email = admin?.email;

  const [form, setForm] = useState({ date: "", amount: "", description: "", payment_method: "Cash" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => { setForm({ ...form, [e.target.name]: e.target.value }); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/add-fund", { ...form, admin_email });
      setMessage(res.data.message);
      setForm({ date: "", amount: "", description: "", payment_method: "Cash" });
    } catch (err) {
      if (err.response?.status === 401) { setMessage("Session expired."); localStorage.clear(); window.location.href = "/login"; return; }
      setMessage("Failed to add fund");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout>
      <div className="animate-in" style={{ maxWidth: "460px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--navy)", marginBottom: "4px" }}>Add New Fund</h1>
        <p style={{ color: "var(--slate)", fontSize: "0.875rem", marginBottom: "24px" }}>Enter fund details below</p>

        <div className="card" style={{ padding: "28px 24px" }}>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.82rem", fontWeight: 500, color: "var(--navy-light)" }}>Date</label>
              <input type="date" name="date" value={form.date} onChange={handleChange} className="input" required />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.82rem", fontWeight: 500, color: "var(--navy-light)" }}>Amount (₹)</label>
              <input type="number" name="amount" placeholder="Enter amount" value={form.amount} onChange={handleChange} className="input" required />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.82rem", fontWeight: 500, color: "var(--navy-light)" }}>Payment Method</label>
              <select name="payment_method" value={form.payment_method} onChange={handleChange} className="input" required>
                <option value="Cash">Cash</option>
                <option value="Online">Online</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.82rem", fontWeight: 500, color: "var(--navy-light)" }}>Description</label>
              <input type="text" name="description" placeholder="Brief description" value={form.description} onChange={handleChange} className="input" required />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: "11px", opacity: loading ? 0.7 : 1 }} disabled={loading}>
              {loading ? "Adding..." : "Add Fund"}
            </button>
          </form>

          {message && (
            <p style={{ textAlign: "center", marginTop: "14px", fontSize: "0.85rem", fontWeight: 500, color: message.toLowerCase().includes("success") ? "var(--green)" : "var(--rose)" }}>
              {message}
            </p>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

export default AddFund;
