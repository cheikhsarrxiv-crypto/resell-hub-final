'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Badge } from '@/components/UI/Button';
import { ArrowLeft, Truck, Check } from 'lucide-react';
import Link from 'next/link';
import { formatCurrency, getStatusLabel, getStatusColor, formatDateTime } from '@/lib/utils';

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const { workspaceId, isReady } = useWorkspace();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [partners, setPartners] = useState<any[]>([]);

  useEffect(() => {
    if (!isReady) return;
    fetchOrder();
    fetchPartners();
  }, [orderId, isReady, workspaceId]);

  const fetchOrder = async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/orders/${orderId}?workspaceId=${workspaceId}`);
      const data = await response.json();
      if (data.success) {
        setOrder(data.order);
      }
    } catch (error) {
      console.error('Failed to fetch order:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPartners = async () => {
    try {
      const response = await fetch('/api/fulfillment/partners');
      const data = await response.json();
      if (data.success) {
        setPartners(data.partners);
      }
    } catch (error) {
      console.error('Failed to fetch partners:', error);
    }
  };

  const handleSendToFulfillment = async () => {
    if (!partners.length || !order) return;

    setSending(true);
    try {
      const response = await fetch('/api/fulfillment/send?workspaceId=' + workspaceId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          partnerId: partners[0].id,
        }),
      });

      if (response.ok) {
        fetchOrder();
      }
    } catch (error) {
      console.error('Failed to send to fulfillment:', error);
    } finally {
      setSending(false);
    }
  };

  const handleSimulateStatus = async (action: string) => {
    if (!order?.fulfillmentOrder) return;

    setSimulating(true);
    try {
      const response = await fetch(
        `/api/fulfillment/simulate?workspaceId=${workspaceId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fulfillmentOrderId: order.fulfillmentOrder.id,
            action,
          }),
        }
      );

      if (response.ok) {
        fetchOrder();
      }
    } catch (error) {
      console.error('Failed to simulate status:', error);
    } finally {
      setSimulating(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading order...</div>;
  }

  if (!order) {
    return <div className="text-center py-12">Order not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/orders">
          <Button variant="secondary" size="sm">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Order Details</h1>
          <p className="text-gray-600 mt-1">{order.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Order Info */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Order Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Customer Info */}
            <div className="border-b pb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Customer</h3>
              <p className="font-medium">{order.customerName}</p>
              <p className="text-sm text-gray-600">{order.customerEmail}</p>
            </div>

            {/* Shipping Info */}
            <div className="border-b pb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Shipping Address</h3>
              <p>{order.shippingAddress}</p>
              <p className="text-sm text-gray-600">
                {order.shippingPostalCode} {order.shippingCity}, {order.shippingCountry}
              </p>
            </div>

            {/* Order Items */}
            <div className="border-b pb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Items</h3>
              <div className="space-y-3">
                {order.items.map((item: any) => (
                  <div key={item.id} className="flex justify-between pb-3 border-b last:border-b-0">
                    <div>
                      <p className="font-medium">{item.title}</p>
                      {item.product ? (
                        <Link
                          href={`/dashboard/products/${item.product.id}`}
                          className="text-sm text-[#FF5A1F] hover:text-[#e64f18]"
                        >
                          SKU: {item.product.sku}
                        </Link>
                      ) : (
                        <p className="text-sm text-gray-600">SKU: —</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{formatCurrency(item.price)}</p>
                      <p className="text-sm text-gray-600">x{item.quantity}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial Summary */}
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-medium">{formatCurrency(order.totalPrice)}</span>
              </div>
              <div className="flex justify-between mb-3 pb-3 border-b">
                <span className="text-gray-600">Marketplace Fees</span>
                <span className="font-medium">-{formatCurrency(order.marketplaceFees)}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-gray-900">Estimated Profit</span>
                <span className="text-lg font-bold text-green-600">
                  {formatCurrency(order.estimatedProfit)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status & Fulfillment */}
        <div className="space-y-6">
          {/* Origin listing */}
          {order.listing && (
            <Card>
              <CardHeader>
                <CardTitle>Listing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-gray-600">
                  {order.listing.connection?.marketplace?.displayName || 'Marketplace'}
                </p>
                <p className="font-medium text-gray-900">{order.listing.title}</p>
                <Link href={`/dashboard/listings/${order.listing.id}`}>
                  <Button variant="outline" size="sm" className="w-full mt-2">
                    View Listing
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Status */}
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`inline-flex px-3 py-2 rounded-lg text-sm font-medium w-full justify-center ${getStatusColor(order.status)}`}>
                {getStatusLabel(order.status)}
              </div>
              <p className="text-xs text-gray-600">
                Created: {formatDateTime(new Date(order.createdAt))}
              </p>
            </CardContent>
          </Card>

          {/* Fulfillment */}
          {!order.fulfillmentOrder && order.fulfillmentType === 'automatic' && (
            <Card>
              <CardHeader>
                <CardTitle>Fulfillment</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-4">
                  Send this order to our fulfillment partner to automate shipping.
                </p>
                <Button
                  onClick={handleSendToFulfillment}
                  loading={sending}
                  variant="primary"
                  className="w-full"
                >
                  <Truck className="w-4 h-4 mr-2" />
                  Send to Fulfillment
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Fulfillment Order Status */}
          {order.fulfillmentOrder && (
            <Card>
              <CardHeader>
                <CardTitle>Fulfillment Order</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs text-gray-600 mb-1">Status</p>
                  <p className="font-semibold capitalize">
                    {order.fulfillmentOrder.status}
                  </p>
                </div>

                <div className="pt-4 space-y-2 border-t">
                  <p className="text-xs text-gray-600">Fulfillment Cost</p>
                  <p className="font-semibold">
                    {formatCurrency(order.fulfillmentOrder.totalCost)}
                  </p>
                  <p className="text-xs text-gray-600">Profit</p>
                  <p className="text-lg font-bold text-green-600">
                    {formatCurrency(order.fulfillmentOrder.profit)}
                  </p>
                </div>

                {/* Simulate Status Changes */}
                <div className="pt-4 space-y-2 border-t">
                  <p className="text-xs text-gray-600 font-semibold">Simulate Status</p>
                  <div className="space-y-1">
                    {['accept', 'processing', 'ship', 'deliver'].map((action) => (
                      <Button
                        key={action}
                        onClick={() => handleSimulateStatus(action)}
                        loading={simulating}
                        variant="secondary"
                        size="sm"
                        className="w-full capitalize"
                      >
                        {action}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Tracking */}
                {order.fulfillmentOrder.shipment?.trackingNumber && (
                  <div className="pt-4 border-t">
                    <p className="text-xs text-gray-600 mb-2">Tracking Number</p>
                    <div className="bg-gray-50 p-3 rounded">
                      <p className="font-mono text-sm font-semibold">
                        {order.fulfillmentOrder.shipment.trackingNumber}
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        {order.fulfillmentOrder.shipment.carrier}
                      </p>
                    </div>
                  </div>
                )}

                {/* Tracking Events */}
                {order.fulfillmentOrder.shipment?.trackingEvents?.length > 0 && (
                  <div className="pt-4 border-t">
                    <p className="text-xs text-gray-600 font-semibold mb-3">Tracking Events</p>
                    <div className="space-y-3">
                      {order.fulfillmentOrder.shipment.trackingEvents.map((event: any, index: number) => (
                        <div key={event.id} className="flex gap-3">
                          <div className="flex-shrink-0 mt-1">
                            <Check className="w-4 h-4 text-green-600" />
                          </div>
                          <div className="flex-grow text-sm">
                            <p className="font-medium capitalize text-gray-900">
                              {event.status.replace(/_/g, ' ')}
                            </p>
                            {event.location && (
                              <p className="text-xs text-gray-600">{event.location}</p>
                            )}
                            <p className="text-xs text-gray-500 mt-1">
                              {formatDateTime(new Date(event.timestamp))}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
