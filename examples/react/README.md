# React example

```bash
npm create vite@latest my-store -- --template react-ts
cd my-store
npm install react-router-dom @grigora/commerce-react @grigora/commerce-adapter-stripe @grigora/commerce-adapter-razorpay
```

Copy `App.tsx` over `src/App.tsx`, wrap it in a `BrowserRouter` in `main.tsx`, set `PROJECT_ID`, and run `npm run dev`.

Routes: `/` (grid), `/product/:slug` (buy box), `/checkout` (`<Checkout />`), `/thank-you` (`<OrderStatus />`). The provider registers the Stripe and Razorpay adapters so payment happens in-page where the store supports it.
