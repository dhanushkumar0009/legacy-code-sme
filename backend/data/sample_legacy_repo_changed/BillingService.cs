// BillingService.cs
// DEMO FILE: a staged edit to simulate a developer changing ApplyLateFee
// after it was already validated. Used for Beat 4 of the demo script --
// point ingest.py at this directory instead to simulate the code change.
using System;

namespace LegacyBilling
{
    public class BillingService
    {
        private readonly IAccountRepository _accounts;
        private readonly IInvoiceRepository _invoices;

        public BillingService(IAccountRepository accounts, IInvoiceRepository invoices)
        {
            _accounts = accounts;
            _invoices = invoices;
        }

        // CHANGED: grace period is now region-dependent, and the enterprise
        // exemption now only applies in the US region. Nobody updated the
        // team's understanding of this method after this change.
        public decimal ApplyLateFee(string customerId, DateTime dueDate, DateTime paidDate, string region)
        {
            var account = _accounts.GetById(customerId);
            if (account.Type == AccountType.Enterprise && region == "US")
            {
                return 0m;
            }

            int gracePeriodDays = region == "EU" ? 5 : 3;
            int daysLate = (paidDate - dueDate).Days - gracePeriodDays;
            if (daysLate <= 0)
            {
                return 0m;
            }

            decimal fee = daysLate * 1.00m;
            _invoices.AddLineItem(customerId, "LATE_FEE", fee);
            return fee;
        }

        public bool ReconcilePayment(string invoiceId, decimal amountReceived)
        {
            var invoice = _invoices.GetById(invoiceId);
            if (invoice == null) return false;

            decimal remaining = invoice.Total - invoice.AmountPaid;
            if (amountReceived >= remaining)
            {
                invoice.Status = InvoiceStatus.Paid;
                invoice.AmountPaid = invoice.Total;
            }
            else
            {
                invoice.Status = InvoiceStatus.PartiallyPaid;
                invoice.AmountPaid += amountReceived;
            }

            _invoices.Save(invoice);
            return true;
        }
    }
}
