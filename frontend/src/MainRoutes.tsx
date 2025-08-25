import { StrictMode } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import Home from "./page/home/home";
import LoginPage from "./page/auth/login/login";
import RegisterPage from "./page/auth/register/register";

import TripPlannerChat from "./page/trip-chat/trip-chat";
import Setting from "./page/settings/setting";
import TripItinerary from "./page/trip-itinerary/trip-itinerary";
import AppLayout from "./layout/AppLayout";
import AuthLayout from "./layout/AuthLayout";

const router = createBrowserRouter([
  {
    element: <AppLayout />,            // Navbar เต็ม
    children: [
      { index: true, element: <Home /> },
      { path: "/trip-chat", element: <TripPlannerChat /> },
      { path: "/settings", element: <Setting /> },
      { path: "/itinerary", element: <TripItinerary /> },
    ],
  },
  {
    element: <AuthLayout />,           // Navbar ย่อ
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
    ],
  },
]);

export default function MainRoutes() {
  return (
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
