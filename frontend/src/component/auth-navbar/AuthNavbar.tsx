import { Link } from "react-router-dom";
import { IoChevronBackSharp } from "react-icons/io5";
import "./auth-navbar.css";

export default function AuthNavbar() {

  return (
        <Link to={"/"}>
          <IoChevronBackSharp size={30} className="back" />
        </Link>
  );
}
