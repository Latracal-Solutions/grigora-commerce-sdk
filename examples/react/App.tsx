/*
  A complete React storefront: product grid from the catalog, a product page
  with the buy box, cart drawer, and a checkout route. Drop this into a Vite +
  React project with react-router, install @grigora/commerce-react and the two
  adapters, and set PROJECT_ID.
*/
import { Link, Route, Routes, useParams } from "react-router-dom";
import {
  AddToCartButton,
  BuyBox,
  CartDrawer,
  CartLauncher,
  Checkout,
  GrigoraProvider,
  OrderStatus,
  useProduct,
  useProducts,
} from "@grigora/commerce-react";
import { stripeAdapter } from "@grigora/commerce-adapter-stripe";
import { razorpayAdapter } from "@grigora/commerce-adapter-razorpay";

const PROJECT_ID = "YOUR_PROJECT_ID";

export default function App() {
  return (
    <GrigoraProvider
      config={{ projectId: PROJECT_ID, successUrl: "/thank-you" }}
      adapters={[stripeAdapter, razorpayAdapter]}
      uiOptions={{ checkoutUrl: "/checkout", continueShoppingUrl: "/" }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", padding: 16 }}>
        <Link to="/">Store</Link>
        <CartLauncher>Cart</CartLauncher>
      </header>
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
        <Routes>
          <Route path="/" element={<Grid />} />
          <Route path="/product/:slug" element={<ProductPage />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/thank-you" element={<OrderStatus continueUrl="/" />} />
        </Routes>
      </main>
      <CartDrawer />
    </GrigoraProvider>
  );
}

function Grid() {
  const { data: products, loading, error } = useProducts({ inStock: true, sort: "newest" });
  if (loading) return <p>Loading…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 24 }}>
      {(products || []).map((product) => (
        <article key={product.id} style={{ display: "grid", gap: 8 }}>
          <Link to={`/product/${product.slug}`}>
            <img src={product.imageUrl} alt={product.title} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 12 }} />
          </Link>
          <h3 style={{ margin: 0 }}>{product.title}</h3>
          <span>{product.priceFormatted}</span>
          {product.hasVariants ? (
            <Link to={`/product/${product.slug}`}>Choose options</Link>
          ) : (
            <AddToCartButton productId={product.id}>Add to cart</AddToCartButton>
          )}
        </article>
      ))}
    </div>
  );
}

function ProductPage() {
  const { slug = "" } = useParams();
  const { data: product, loading } = useProduct(slug);
  if (loading || !product) return <p>Loading…</p>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
      <img src={product.imageUrl} alt={product.title} style={{ width: "100%", borderRadius: 16 }} />
      <div>
        <h1>{product.title}</h1>
        <p>{product.description}</p>
        <BuyBox product={product.slug} />
      </div>
    </div>
  );
}
