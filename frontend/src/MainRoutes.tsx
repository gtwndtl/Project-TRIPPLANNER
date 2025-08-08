import React, { StrictMode } from "react";

import Home from "./page/home/home";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import ChatPage from "./page/chatpage/chatpage";
import TripSummaryPage from "./page/tripsummarypage/tripsummarypage";
import SettingPage from "./page/settingpage/settingpage";

const MainRoutes: React.FC = () => {
  const router = createBrowserRouter([
    {
      path: "/",
      element: <Home />,
    },
    {
      path: "/chat",
      element: <ChatPage />,
    },
    {
      path: "/trip",
      element: <TripSummaryPage />,
    },
    {
      path: "/settings/*",
      element: <SettingPage />,
    },
  ]);

  return (
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
};

export default MainRoutes;