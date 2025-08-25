import { Outlet } from "react-router-dom";
import AuthNavbar from "../component/auth-navbar/AuthNavbar";

export default function AuthLayout() {
  return (
    <>
      <AuthNavbar />
      <main className="auth-main">
        <Outlet />
      </main>
    </>
  );
}
