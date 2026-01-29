// Use /api in browser (to hit Vite proxy), or full URL in Node (tests)
const IS_BROWSER = typeof window !== 'undefined';
export const API_URL = IS_BROWSER
    ? "/api"
    : "https://puma-backend-demo-production.up.railway.app";

export interface Order {
    order_id: string;
    status: string;
    items: string;
    created_at: string;
    refund_status?: string;
    refund_rrn?: string;
}

export async function fetchCustomerOrders(email: string): Promise<Order[]> {
    console.log(`[API] Fetching orders for email: ${email}`);
    try {
        const res = await fetch(`${API_URL}/orders?email=${encodeURIComponent(email)}`);
        console.log(`[API] Fetch Orders Status: ${res.status}`);

        if (!res.ok) {
            const err = await res.text();
            console.error(`[API] Error response: ${err}`);
            return [];
        }

        const data = await res.json();
        console.log(`[API] Orders Data:`, data);
        return data;
    } catch (e) {
        console.error("Fetch Orders Error:", e);
        return [];
    }
}

export async function fetchOrderById(orderId: string): Promise<Order | null> {
    console.log(`[API] Fetching order by ID: ${orderId}`);
    try {
        const res = await fetch(`${API_URL}/orders/${orderId}`);
        console.log(`[API] Fetch Order Status: ${res.status}`);

        if (!res.ok) {
            console.warn(`[API] Order ${orderId} not found or error.`);
            return null;
        }

        const data = await res.json();
        console.log(`[API] Order Data:`, data);
        return data;
    } catch (e) {
        console.error("Fetch Order ID Error:", e);
        return null;
    }
}
