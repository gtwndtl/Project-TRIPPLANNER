import { Outlet } from "react-router-dom";
import Navbar from "../component/navbar/navbar";

export default function AppLayout() {
  return (
    <>
      <Navbar />
      <Outlet />
    </>
  );
}
