// BillingService.cs
// No comments, no docs, written 2014. Nobody currently on the team wrote this file.
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

        public decimal ApplyLateFee(string customerId, DateTime dueDate, DateTime paidDate)
        {
            var account = _accounts.GetById(customerId);
            if (account.Type == AccountType.Enterprise)
            {
                return 0m;
            }

            int daysLate = (paidDate - dueDate).Days - 3;
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
