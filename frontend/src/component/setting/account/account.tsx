// src/component/setting/account/account.tsx
import { message } from "antd";
import type { UserInterface } from "../../../interfaces/User";
import "./account.css";

type Props = Pick<UserInterface, "Email"> & {
  onChangePassword?: () => void;
  onDeactivate?: () => void;
};

const AccountInfo = ({ Email, onChangePassword, onDeactivate }: Props) => {
  const [messageApi, contextHolder] = message.useMessage();

  const handleDeactivate = () => {
    const ok = confirm("ต้องการปิดใช้งานบัญชีหรือไม่?");
    if (ok) {
      if (onDeactivate) {
        onDeactivate();
      } else {
        messageApi.success("ปิดใช้งานบัญชีแล้ว (demo)");
      }
    }
  };

  return (
    <>
      {contextHolder}

      <h3 className="setting-section-title">Account settings</h3>

      <div className="setting-row">
        <p className="setting-row-label">Email</p>
        <div className="setting-row-value">
          <p>{Email}</p>
        </div>
      </div>

      <div className="setting-row">
        <p className="setting-row-label">Password</p>
        <div className="setting-row-value">
          <button
            className="setting-chip-btn"
            onClick={() => onChangePassword?.()}
          >
            Change
          </button>
        </div>
      </div>

      <div className="setting-row">
        <p className="setting-row-label">Deactivate account</p>
        <div className="setting-row-value">
          <button className="setting-chip-btn" onClick={handleDeactivate}>
            Deactivate
          </button>
        </div>
      </div>
    </>
  );
};

export default AccountInfo;
