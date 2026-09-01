import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AccesoPro",
  description: "Acceso y seguridad para barrios cerrados",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
