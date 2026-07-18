import os
import base64
import io
import time
from flask import Flask, request, jsonify, send_file
from werkzeug.security import generate_password_hash, check_password_hash
from firebase_setup import db
from google.cloud import firestore
from flask_cors import CORS
import uuid
from openpyxl import Workbook

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

@app.route("/health")
def health():
    return {"status": "ok", "message": "Backend is healthy and reachable"}

# ----------------------------------------------------
# ⚡ IN-MEMORY CACHE FOR SUMMARIES
# ----------------------------------------------------
summary_cache = {"data": None, "timestamp": 0}
employee_cache = {}  # {email: {"data": ..., "timestamp": ...}}
session_cache = {}   # {token: {"data": ..., "timestamp": ...}}
SUMMARY_CACHE_TTL = 30  # seconds
SESSION_CACHE_TTL = 300  # 5 minutes

def invalidate_summary_cache():
    """Call this whenever expenses or funds change."""
    summary_cache["data"] = None
    summary_cache["timestamp"] = 0
    employee_cache.clear()

# ----------------------------------------------------
# 🔐 SESSION VALIDATION (CACHED)
# ----------------------------------------------------
def validate_session(data):
    token = data.get("session_token") if isinstance(data, dict) else request.args.get("session_token")

    if not token:
        return False, jsonify({"error": "Session token missing"}), 401

    # Check session cache first (saves ~200ms per request)
    now = time.time()
    cached = session_cache.get(token)
    if cached and (now - cached["timestamp"]) < SESSION_CACHE_TTL:
        return True, cached["data"], 200

    # Cache miss — hit Firestore
    session_ref = db.collection("sessions").document(token).get()

    if not session_ref.exists:
        # Remove from cache if it was there
        session_cache.pop(token, None)
        return False, jsonify({"error": "Invalid or expired session"}), 401

    sess_data = session_ref.to_dict()
    session_cache[token] = {"data": sess_data, "timestamp": now}
    return True, sess_data, 200


# ----------------------------------------------------
# 👤 USER NAME CACHE (avoids N+1 queries)
# ----------------------------------------------------
def get_user_name_cache():
    """Load all users into a dict {email: name} in a single query."""
    cache = {}
    for u in db.collection("users").stream():
        data = u.to_dict()
        cache[data.get("email", u.id)] = data.get("name", "Unknown")
    return cache


@app.route("/")
def home():
    return {"status": "Backend running successfully 🚀"}


# ------------------- SIGNUP API -------------------
@app.route("/signup", methods=["POST"])
def signup():
    data = request.json
    name = data.get("name")
    email = data.get("email")
    password = data.get("password")
    role = data.get("role")

    if not name or not email or not password:
        return jsonify({"error": "All fields are required"}), 400

    user_ref = db.collection("users").document(email).get()
    if user_ref.exists:
        return jsonify({"error": "User already exists"}), 409

    hashed_password = generate_password_hash(password)

    db.collection("users").document(email).set({
        "name": name,
        "email": email,
        "password": hashed_password,
        "role": role
    })

    return jsonify({"message": "Signup successful"}), 201


# ------------------- LOGIN API -------------------
@app.route("/login", methods=["POST"])
def login():
    data = request.json
    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"error": "Email and Password are required"}), 400

    user_ref = db.collection("users").document(email).get()
    if not user_ref.exists:
        return jsonify({"error": "User not found"}), 404

    user = user_ref.to_dict()

    if not check_password_hash(user["password"], password):
        return jsonify({"error": "Incorrect password"}), 401

    # CREATE SESSION TOKEN
    session_token = str(uuid.uuid4())
    db.collection("sessions").document(session_token).set({
        "email": email,
        "role": user["role"]
    })

    return jsonify({
        "message": "Login successful",
        "session": session_token,   # 🔥 return session
        "user": {
            "name": user["name"],
            "email": user["email"],
            "role": user["role"]
        }
    }), 200


# ------------------- ADD EXPENSE (PENDING) -------------------
@app.route("/add-expense", methods=["POST"])
def add_expense():
    data = request.json

    valid, sess, code = validate_session(data)
    if not valid:
        return sess, code

    try:
        date = data.get("date")
        description = data.get("description")
        amount = float(data.get("amount"))
        bill_image_base64 = data.get("bill_image")
        email = data.get("email")

        if not all([date, description, amount, email]):
            return jsonify({"error": "Missing fields"}), 400

        # Save expense as PENDING — balance NOT deducted yet
        expense_data = {
            "date": date,
            "description": description,
            "amount": amount,
            "email": email,
            "status": "pending",
            "payment_method": data.get("payment_method", "Cash")
        }
        if bill_image_base64:
            expense_data["bill_image"] = bill_image_base64

        db.collection("expenses").add(expense_data)

        # Increment total submitted for the employee
        db.collection("employee_stats").document(email).set({
            "total_submitted_amount": firestore.Increment(amount),
            "total_submitted_count": firestore.Increment(1)
        }, merge=True)

        invalidate_summary_cache()
        return jsonify({"message": "Expense submitted successfully (pending admin approval)"}), 200

    except Exception as e:
        print("ERROR:", e)
        return jsonify({"error": "Internal Server Error"}), 500


# ------------------- ADMIN DISBURSE EXPENSE -------------------
@app.route("/admin/disburse-expense", methods=["POST"])
def disburse_expense():
    data = request.json

    valid, sess, code = validate_session(data)
    if not valid:
        return sess, code

    try:
        expense_id = data.get("expense_id")
        if not expense_id:
            return jsonify({"error": "Expense ID is required"}), 400

        expense_ref = db.collection("expenses").document(expense_id)
        expense_doc = expense_ref.get()

        if not expense_doc.exists:
            return jsonify({"error": "Expense not found"}), 404

        expense = expense_doc.to_dict()

        if expense.get("status") == "disbursed":
            return jsonify({"error": "Expense already disbursed"}), 400

        amount = float(expense.get("amount", 0))

        # Check balance
        balance_doc = db.collection("fund_balance").document("main").get()
        current_balance = balance_doc.to_dict().get("balance", 0) if balance_doc.exists else 0

        if amount > current_balance:
            return jsonify({"error": "Insufficient balance", "available_balance": current_balance}), 400

        # Mark as disbursed and deduct balance
        expense_ref.update({"status": "disbursed"})

        new_balance = current_balance - amount
        
        # Increment total disbursed and decrement balance
        db.collection("fund_balance").document("main").update({
            "balance": new_balance,
            "total_expenses_amount": firestore.Increment(amount)
        })

        # Increment total disbursed for the employee
        employee_email = expense.get("email")
        if employee_email:
            db.collection("employee_stats").document(employee_email).set({
                "total_disbursed_amount": firestore.Increment(amount),
                "total_disbursed_count": firestore.Increment(1)
            }, merge=True)

        invalidate_summary_cache()
        return jsonify({"message": "Expense disbursed successfully", "new_balance": new_balance}), 200

    except Exception as e:
        print("ERROR:", e)
        return jsonify({"error": "Internal Server Error"}), 500


# ------------------- GET MY EXPENSES -------------------
@app.route("/get-expenses/<email>", methods=["GET"])
def get_expenses(email):

    valid, sess, code = validate_session(request.args)
    if not valid:
        return sess, code

    try:
        expenses_ref = db.collection("expenses").where("email", "==", email).stream()

        expenses = []
        for exp in expenses_ref:
            data = exp.to_dict()
            data["id"] = exp.id
            data.setdefault("status", "pending")
            data.setdefault("payment_method", "Cash")
            expenses.append(data)

        return jsonify({"expenses": expenses}), 200
    except Exception as e:
        return jsonify({"error": "Failed to retrieve expenses"}), 500


# ------------------- ADD FUND -------------------
@app.route("/add-fund", methods=["POST"])
def add_fund():
    data = request.json

    valid, sess, code = validate_session(data)
    if not valid:
        return sess, code

    try:
        date = data.get("date")
        amount = float(data.get("amount"))
        description = data.get("description")
        admin_email = data.get("admin_email")
        payment_method = data.get("payment_method", "Cash")

        if not all([date, amount, admin_email]):
            return jsonify({"error": "Missing fields"}), 400

        db.collection("funds").add({
            "date": date,
            "amount": amount,
            "description": description,
            "admin_email": admin_email,
            "payment_method": payment_method
        })

        balance_doc = db.collection("fund_balance").document("main").get()
        current_data = balance_doc.to_dict() if balance_doc.exists else {"balance": 0, "total_fund_amount": 0}
        current_balance = current_data.get("balance", 0)

        new_balance = current_balance + amount
        
        db.collection("fund_balance").document("main").set({
            "balance": new_balance,
            "total_fund_amount": firestore.Increment(amount)
        }, merge=True)

        invalidate_summary_cache()
        return jsonify({"message": "Fund added successfully"}), 200

    except Exception as e:
        return jsonify({"error": "Internal Server Error"}), 500


# ------------------- GET ALL FUNDS -------------------
@app.route("/get-all-funds", methods=["GET"])
def get_all_funds():

    valid, sess, code = validate_session(request.args)
    if not valid:
        return sess, code

    try:
        user_cache = get_user_name_cache()
        fund_ref = db.collection("funds").order_by("date").stream()

        funds = []
        for f in fund_ref:
            data = f.to_dict()
            admin_email = data.get("admin_email", "")

            funds.append({
                "id": f.id,
                "date": data.get("date"),
                "amount": data.get("amount"),
                "description": data.get("description"),
                "payment_method": data.get("payment_method", "Cash"),
                "admin_name": user_cache.get(admin_email, "Unknown")
            })

        return jsonify({"funds": funds}), 200

    except Exception as e:
        return jsonify({"error": "Failed to retrieve funds"}), 500


# ------------------- SUMMARY (CACHED) -------------------
@app.route("/get-summary", methods=["GET"])
def get_summary():

    valid, sess, code = validate_session(request.args)
    if not valid:
        return sess, code

    try:
        # Return cached data if fresh
        now = time.time()
        if summary_cache["data"] and (now - summary_cache["timestamp"]) < SUMMARY_CACHE_TTL:
            return jsonify(summary_cache["data"]), 200

        # Read stored balance and totals (1 read)
        balance_doc = db.collection("fund_balance").document("main").get()
        balance_data = balance_doc.to_dict() if balance_doc.exists else {}
        
        balance = balance_data.get("balance", 0)
        total_fund = balance_data.get("total_fund_amount", 0)
        total_expenses = balance_data.get("total_expenses_amount", 0)

        # Migration/Initialization: If totals are missing OR inconsistent (e.g. pending < 0), recalculate once
        needs_init = (
            "total_fund_amount" not in balance_data or 
            "total_expenses_amount" not in balance_data or 
            "total_expenses_count" not in balance_data or
            "balance" not in balance_data or
            (total_fund - total_expenses) != balance  # Check for internal consistency
        )

        if needs_init:
            print("RE-INITIALIZING TOTALS IN FUND_BALANCE...")
            actual_total_fund = sum([float(f.to_dict().get("amount", 0)) for f in db.collection("funds").stream()])
            
            all_expenses = [e.to_dict() for e in db.collection("expenses").stream()]
            actual_total_expenses = sum([float(e.get("amount", 0)) for e in all_expenses if e.get("status") == "disbursed"])
            
            # Correct balance is Funds - Disbursed Expenses
            actual_balance = actual_total_fund - actual_total_expenses
            
            actual_expenses_count = sum(1 for e in all_expenses if e.get("status") == "disbursed")
            
            db.collection("fund_balance").document("main").set({
                "balance": actual_balance,
                "total_fund_amount": actual_total_fund,
                "total_expenses_amount": actual_total_expenses,
                "total_expenses_count": actual_expenses_count
            }, merge=True)
            
            balance = actual_balance
            total_fund = actual_total_fund
            total_expenses = actual_total_expenses
            total_expenses_count = actual_expenses_count
        else:
            total_expenses_count = balance_data.get("total_expenses_count", 0)

        # Calculate current pending amount dynamically (since it changes status)
        pending_expenses = list(db.collection("expenses").where("status", "==", "pending").stream())
        pending_count = len(pending_expenses)
        pending_amount = sum([float(e.to_dict().get("amount", 0)) for e in pending_expenses])

        result = {
            "total_fund": total_fund,
            "total_expenses": total_expenses, # Disbursed
            "total_submitted_amount": total_expenses + pending_amount, # Disbursed + Pending
            "balance": balance,
            "pending_count": pending_count,
            "total_expenses_count": total_expenses_count
        }

        # Store in cache
        summary_cache["data"] = result
        summary_cache["timestamp"] = now

        return jsonify(result), 200

    except Exception as e:
        print("ERROR:", e)
        return jsonify({"error": "Internal Server Error"}), 500


# ------------------- EMPLOYEE SUMMARY (CACHED) -------------------
@app.route("/get-employee-summary/<email>", methods=["GET"])
def get_employee_summary(email):

    valid, sess, code = validate_session(request.args)
    if not valid:
        return sess, code

    try:
        # Return cached data if fresh
        now = time.time()
        cached = employee_cache.get(email)
        if cached and (now - cached["timestamp"]) < SUMMARY_CACHE_TTL:
            return jsonify(cached["data"]), 200

        # Read stored employee stats
        stats_doc = db.collection("employee_stats").document(email).get()
        stats_data = stats_doc.to_dict() if stats_doc.exists else {}

        total_submitted = stats_data.get("total_submitted_amount", 0)
        total_disbursed = stats_data.get("total_disbursed_amount", 0)

        # Fetch actual expenses list (for the table)
        expenses_ref = db.collection("expenses").where("email", "==", email).stream()
        expenses_list = []
        
        # Migration/Initialization: If stats are missing OR inconsistent (e.g. total_submitted < total_disbursed), recalculate
        needs_init = (
            "total_submitted_amount" not in stats_data or 
            "total_disbursed_amount" not in stats_data or
            "total_submitted_count" not in stats_data or
            "total_disbursed_count" not in stats_data or
            (total_submitted < total_disbursed)
        )

        if needs_init:
            print(f"RE-INITIALIZING STATS FOR {email}...")
            actual_submitted = 0
            actual_disbursed = 0
            actual_count_submitted = 0
            actual_count_disbursed = 0
            
            # Reset expenses list to ensure we don't double up
            expenses_list = []
            expenses_ref = db.collection("expenses").where("email", "==", email).stream()
            
            for exp in expenses_ref:
                data = exp.to_dict()
                data["id"] = exp.id
                data.setdefault("status", "pending")
                data.setdefault("payment_method", "Cash")
                amount = float(data.get("amount", 0))
                
                actual_submitted += amount
                actual_count_submitted += 1
                if data["status"] == "disbursed":
                    actual_disbursed += amount
                    actual_count_disbursed += 1
                
                expenses_list.append(data)
            
            # Update the stats document
            db.collection("employee_stats").document(email).set({
                "total_submitted_amount": actual_submitted,
                "total_disbursed_amount": actual_disbursed,
                "total_submitted_count": actual_count_submitted,
                "total_disbursed_count": actual_count_disbursed
            }, merge=True)
            
            total_submitted = actual_submitted
            total_disbursed = actual_disbursed
            total_count = actual_count_submitted
            disbursed_count = actual_count_disbursed
        else:
            # Stats are valid, just get the expenses for the table
            for exp in expenses_ref:
                data = exp.to_dict()
                data["id"] = exp.id
                data.setdefault("status", "pending")
                data.setdefault("payment_method", "Cash")
                expenses_list.append(data)
            
            total_count = stats_data.get("total_submitted_count", 0)
            disbursed_count = stats_data.get("total_disbursed_count", 0)

        total_pending = total_submitted - total_disbursed
        pending_count = total_count - disbursed_count

        result = {
            "total_submitted": total_submitted,
            "total_disbursed": total_disbursed,
            "total_pending": total_pending,
            "pending_count": pending_count,
            "disbursed_count": disbursed_count,
            "total_count": total_count,
            "expenses": expenses_list
        }

        # Store in per-employee cache
        employee_cache[email] = {"data": result, "timestamp": now}

        return jsonify(result), 200

    except Exception as e:
        print("ERROR:", e)
        return jsonify({"error": "Internal Server Error"}), 500


# ------------------- ADMIN GET ALL EXPENSES -------------------
@app.route("/admin/get-all-expenses", methods=["GET"])
def admin_get_all_expenses():

    valid, sess, code = validate_session(request.args)
    if not valid:
        return sess, code

    try:
        user_cache = get_user_name_cache()
        expenses_ref = db.collection("expenses").stream()
        expenses = []

        for exp in expenses_ref:
            data = exp.to_dict()
            email = data.get("email", "")

            expenses.append({
                "id": exp.id,
                "employee_name": user_cache.get(email, "Unknown"),
                "email": email,
                "description": data.get("description"),
                "amount": data.get("amount"),
                "date": data.get("date"),
                "bill_image": data.get("bill_image"),
                "status": data.get("status", "pending"),
                "payment_method": data.get("payment_method", "Cash")
            })

        return jsonify({"expenses": expenses}), 200

    except:
        return jsonify({"error": "Failed to fetch expenses"}), 500


# ------------------- ADMIN EMPLOYEE EXPENSES STATS -------------------
@app.route("/admin/employee-expenses-stats", methods=["GET"])
def admin_employee_expenses_stats():
    valid, sess, code = validate_session(request.args)
    if not valid:
        return sess, code
    
    if sess.get("role") != "admin":
        return jsonify({"error": "Admin access required"}), 403

    try:
        user_cache = get_user_name_cache()
        stats_ref = db.collection("employee_stats").stream()
        
        data = []
        for s in stats_ref:
            email = s.id
            stats = s.to_dict()
            data.append({
                "name": user_cache.get(email, email.split("@")[0]),
                "total_expense": stats.get("total_submitted_amount", 0)
            })
            
        return jsonify(data), 200
    except Exception as e:
        print("ERROR:", e)
        return jsonify({"error": "Failed to fetch employee stats"}), 500


# ------------------- UPDATE EXPENSE -------------------
@app.route("/update-expense/<expense_id>", methods=["PUT"])
def update_expense(expense_id):
    data = request.json

    valid, sess, code = validate_session(data)
    if not valid:
        return sess, code

    try:
        expense_ref = db.collection("expenses").document(expense_id)
        expense_doc = expense_ref.get()

        if not expense_doc.exists:
            return jsonify({"error": "Expense not found"}), 404

        expense = expense_doc.to_dict()

        # Only pending expenses can be edited
        if expense.get("status") == "disbursed":
            return jsonify({"error": "Cannot edit a disbursed expense"}), 400

        # Employees can only update their own expenses
        user_role = sess.get("role")
        user_email = sess.get("email")
        if user_role != "admin" and expense.get("email") != user_email:
            return jsonify({"error": "You can only edit your own expenses"}), 403

        update_fields = {}
        old_amount = float(expense.get("amount", 0))
        new_amount = old_amount
        
        if data.get("description"):
            update_fields["description"] = data["description"]
        if data.get("amount"):
            new_amount = float(data["amount"])
            update_fields["amount"] = new_amount
        if data.get("date"):
            update_fields["date"] = data["date"]
        if data.get("bill_image"):
            update_fields["bill_image"] = data["bill_image"]
        if data.get("payment_method"):
            update_fields["payment_method"] = data["payment_method"]

        if not update_fields:
            return jsonify({"error": "No fields to update"}), 400

        expense_ref.update(update_fields)

        # If amount changed, update the persistent stats for the employee
        if new_amount != old_amount:
            delta = new_amount - old_amount
            db.collection("employee_stats").document(expense.get("email")).set({
                "total_submitted_amount": firestore.Increment(delta)
            }, merge=True)

        invalidate_summary_cache()
        return jsonify({"message": "Expense updated successfully"}), 200

    except Exception as e:
        print("ERROR:", e)
        return jsonify({"error": "Internal Server Error"}), 500


# ------------------- DELETE EXPENSE -------------------
@app.route("/delete-expense/<expense_id>", methods=["DELETE"])
def delete_expense(expense_id):
    data = request.json or {}
    token = data.get("session_token") or request.args.get("session_token")
    if not token:
        return jsonify({"error": "Session token missing"}), 401

    session_ref = db.collection("sessions").document(token).get()
    if not session_ref.exists:
        return jsonify({"error": "Invalid or expired session"}), 401

    sess = session_ref.to_dict()

    try:
        expense_ref = db.collection("expenses").document(expense_id)
        expense_doc = expense_ref.get()

        if not expense_doc.exists:
            return jsonify({"error": "Expense not found"}), 404

        expense = expense_doc.to_dict()

        # Only pending expenses can be deleted (except by admin)
        if expense.get("status") == "disbursed" and sess.get("role") != "admin":
            return jsonify({"error": "Cannot delete a disbursed expense"}), 400

        # Employees can only delete their own expenses
        user_role = sess.get("role")
        user_email = sess.get("email")
        if user_role != "admin" and expense.get("email") != user_email:
            return jsonify({"error": "You can only delete your own expenses"}), 403

        expense_ref.delete()

        invalidate_summary_cache()
        return jsonify({"message": "Expense deleted successfully"}), 200

    except Exception as e:
        print("ERROR:", e)
        return jsonify({"error": "Internal Server Error"}), 500


# ------------------- EXPORT EXCEL -------------------
@app.route("/admin/export-expenses-excel", methods=["GET"])
def export_expenses_excel():

    valid, sess, code = validate_session(request.args)
    if not valid:
        return sess, code

    try:
        user_cache = get_user_name_cache()
        expenses_ref = db.collection("expenses").stream()
        wb = Workbook()
        ws = wb.active
        ws.title = "Expenses"

        ws.append(["Employee Name", "Description", "Amount", "Date", "Payment Method", "Status"])

        # Collect all expenses and sort by date
        all_rows = []
        for exp in expenses_ref:
            data = exp.to_dict()
            email = data.get("email", "")

            all_rows.append({
                "employee_name": user_cache.get(email, "Unknown"),
                "description": data.get("description"),
                "amount": data.get("amount"),
                "date": data.get("date", ""),
                "payment_method": data.get("payment_method", "Cash"),
                "status": data.get("status", "pending")
            })

        all_rows.sort(key=lambda x: x["date"])

        for row in all_rows:
            ws.append([
                row["employee_name"],
                row["description"],
                row["amount"],
                row["date"],
                row["payment_method"],
                row["status"]
            ])

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)

        return send_file(
            output,
            as_attachment=True,
            download_name="expenses.xlsx",
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    except:
        return jsonify({"error": "Failed to export Excel"}), 500



if __name__ == "__main__":
    # Render provides the port in an environment variable `PORT`
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
