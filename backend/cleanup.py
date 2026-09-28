import sqlite3
conn = sqlite3.connect("legacy_sme.db")
conn.execute("DELETE FROM entity_state WHERE entity = 'BillingService.ApplyLateFee'")
conn.commit()
print("done")