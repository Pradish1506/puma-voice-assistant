const API_URL = "https://puma-backend-demo-production.up.railway.app";
const ORDER_ID = "12345";

console.log(`[TEST] Fetching order ${ORDER_ID} from ${API_URL}...`);

try {
    const res = await fetch(`${API_URL}/orders/${ORDER_ID}`);
    console.log(`[TEST] Status: ${res.status}`);
    if (res.ok) {
        const data = await res.json();
        console.log("[TEST] Response Data:");
        console.log(JSON.stringify(data, null, 2));
    } else {
        console.log("[TEST] Response Text:", await res.text());
    }
} catch (error) {
    console.error("[TEST] Error:", error.message);
}
