// OrderCancellationService.cs
// Legacy order-management module. Predates the current microservice split.
using System;

namespace LegacyOrders
{
    public class OrderCancellationService
    {
        private readonly IInventoryService _inventory;
        private readonly IShipmentStatusValidator _shipmentValidator;
        private readonly IOrderRepository _orders;

        public OrderCancellationService(IInventoryService inventory,
                                         IShipmentStatusValidator shipmentValidator,
                                         IOrderRepository orders)
        {
            _inventory = inventory;
            _shipmentValidator = shipmentValidator;
            _orders = orders;
        }

        public CancellationResult CancelOrder(string orderId, string reason)
        {
            var order = _orders.GetById(orderId);

            if (_shipmentValidator.HasShipped(orderId))
            {
                return CancellationResult.Rejected("Order already shipped");
            }

            _inventory.ReleaseReservation(orderId);
            order.Status = OrderStatus.Cancelled;
            order.CancellationReason = reason;
            _orders.Save(order);

            return CancellationResult.Success();
        }
    }
}
