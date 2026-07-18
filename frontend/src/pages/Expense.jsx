import { useState } from "react";
import imageCompression from "browser-image-compression";
import EmployeeLayout from "../layouts/EmployeeLayout";
import { api } from "../api";

function Expense() {
  const user = JSON.parse(localStorage.getItem("user"));
  const email = user?.email;

  const [form, setForm] = useState({ date: "", description: "", amount: "", payment_method: "Cash" });
  const [billImageBase64, setBillImageBase64] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => { setForm({ ...form, [e.target.name]: e.target.value }); };

  const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];

  const handleImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setMessage("Only JPG, JPEG, PNG, and PDF files are allowed.");
      e.target.value = "";
      return;
    }
    try {
      if (file.type === "application/pdf") {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = () => setBillImageBase64(reader.result);
      } else {
        const compressed = await imageCompression(file, { maxSizeMB: 0.02, maxWidthOrHeight: 800, useWebWorker: true });
        const reader = new FileReader();
        reader.readAsDataURL(compressed);
        reader.onloadend = () => setBillImageBase64(reader.result);
      }
      setMessage("");
    } catch (err) {
      console.log("File processing failed", err);
      setMessage("Failed to process file.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/add-expense", { ...form, bill_image: billImageBase64 || "", email });
      setMessage(res.data.message);
      setForm({ date: "", description: "", amount: "", payment_method: "Cash" });
      setBillImageBase64("");
    } catch (err) {
      if (err.response?.status === 401) { setMessage("Session expired."); localStorage.clear(); window.location.href = "/login"; return; }
      setMessage("Expense saving failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <EmployeeLayout>
      <div className="animate-in" style={{ maxWidth: "460px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--navy)", marginBottom: "4px" }}>Add Expense</h1>
        <p style={{ color: "var(--slate)", fontSize: "0.875rem", marginBottom: "24px" }}>Submit a new expense for approval</p>

        <div className="card" style={{ padding: "28px 24px" }}>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.82rem", fontWeight: 500, color: "var(--navy-light)" }}>Date</label>
              <input type="date" name="date" value={form.date} onChange={handleChange} className="input" required />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.82rem", fontWeight: 500, color: "var(--navy-light)" }}>Description</label>
              <input type="text" name="description" value={form.description} placeholder="What was this expense for?" onChange={handleChange} className="input" required />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.82rem", fontWeight: 500, color: "var(--navy-light)" }}>Amount (₹)</label>
              <input type="number" name="amount" value={form.amount} placeholder="Enter amount" onChange={handleChange} className="input" required />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.82rem", fontWeight: 500, color: "var(--navy-light)" }}>Payment Method</label>
              <select name="payment_method" value={form.payment_method} onChange={handleChange} className="input" required>
                <option value="Cash">Cash</option>
                <option value="Online">Online</option>
              </select>
            </div>

            {/* File Upload */}
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "0.82rem", fontWeight: 500, color: "var(--navy-light)" }}>Bill (Optional)</label>
              <label style={{ display: "block", padding: "16px", textAlign: "center", borderRadius: "8px", border: "2px dashed var(--border)", cursor: "pointer", color: billImageBase64 ? "var(--green)" : "var(--slate-light)", fontSize: "0.875rem", transition: "border-color 0.2s" }}>
                {billImageBase64
                  ? (billImageBase64.startsWith("data:application/pdf") ? "📄 PDF uploaded ✔" : "🖼️ Image uploaded ✔")
                  : "📎 Upload bill (JPG, PNG, or PDF)"}
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleImage} style={{ display: "none" }} />
              </label>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: "11px", opacity: loading ? 0.7 : 1 }} disabled={loading}>
              {loading ? "Submitting..." : "Submit Expense"}
            </button>
          </form>

          {message && (
            <p style={{ textAlign: "center", marginTop: "14px", fontSize: "0.85rem", fontWeight: 500, color: message.toLowerCase().includes("success") ? "var(--green)" : "var(--rose)" }}>
              {message}
            </p>
          )}
        </div>
      </div>
    </EmployeeLayout>
  );
}

export default Expense;
