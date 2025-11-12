import { Link } from "@remix-run/react";

export default function About() {
  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-6">About Us</h1>
      <img
        src="https://vendure-backend-production-8b44.up.railway.app/assets/preview/c6/images__preview.jpeg?preset=medium"
        alt="Placeholder virtu company image"
        className="rounded-lg mb-6 w-full h-auto object-cover"
      />
      <p className="text-lg text-gray-700 mb-4">
        Welcome to our store. We believe in delivering great products and a seamless shopping experience.
      </p>
      <p className="text-lg text-gray-700 mb-4">
        This page is a placeholder. You can edit it to include information about your company history, team, or values.
      </p>
      <p className="text-lg text-gray-700">
        Want to get back to shopping?{" "}
        <Link to="/" className="text-primary-500 hover:text-primary-600 underline">
          Return to the home page
        </Link>.
      </p>
    </main>
  );
}
