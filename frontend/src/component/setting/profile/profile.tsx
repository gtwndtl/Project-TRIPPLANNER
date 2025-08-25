import "./profile.css";
import type { UserInterface } from '../../../interfaces/User';

const ProfileInfo = ({
  Firstname,
  Lastname,
  Age,
  Birthday,
}: UserInterface) => {
  return (
    <>
      <h3 className="setting-section-title">Personal info</h3>

      <div className="setting-row">
        <p className="setting-row-label">First Name</p>
        <div className="setting-row-value">
          <p>{Firstname}</p>
        </div>
      </div>

      <div className="setting-row">
        <p className="setting-row-label">Last name</p>
        <div className="setting-row-value">
          <p>{Lastname}</p>
        </div>
      </div>

      <div className="setting-row">
        <p className="setting-row-label">Date of birth</p>
        <div className="setting-row-value">
          <p>{Birthday}</p>
        </div>
      </div>

      <div className="setting-row">
        <p className="setting-row-label">Age</p>
        <div className="setting-row-value">
          <p>{Age}</p>
        </div>
      </div>
    </>
  );
};

export default ProfileInfo;
