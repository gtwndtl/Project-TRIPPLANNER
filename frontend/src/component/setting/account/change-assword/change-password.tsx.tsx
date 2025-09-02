// src/component/setting/account/ChangePassword.tsx
import { Button, Form, Input, message } from "antd";
import { ChangePassword as changePasswordAPI } from "../../../../services/https";
import type { ChangePasswordInput } from "../../../../interfaces/ChangePassword";
import { EyeInvisibleOutlined, EyeTwoTone } from "@ant-design/icons";
import './change-password.css';
import { useState } from "react";


type Props = { onClose?: () => void };
const ChangePassword = ({ onClose }: Props) => {
  const [form] = Form.useForm<ChangePasswordInput>();
  const [messageApi, contextHolder] = message.useMessage();
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: ChangePasswordInput) => {
    try {
      setSubmitting(true);
      const payload: ChangePasswordInput = {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      };

      const res = await changePasswordAPI(payload);

      messageApi.open({
        type: "success",
        content: res?.message || "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว",
        duration: 1.6,
      });

      // ปิดหน้าหลังแจ้งเตือน
      setTimeout(() => onClose?.(), 800);
    } catch (err: any) {
      messageApi.open({
        type: "error",
        content: err?.message || "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์",
        duration: 2.5,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {contextHolder}
      <h3 className="setting-section-title">Change Password</h3>
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
        autoComplete="off"
        requiredMark={false}
        className="change-password-form"
      >
        <div className="setting-row">
          <p className="setting-row-label">Current Password</p>
          <div className="setting-row-value">
            <Form.Item
              name="currentPassword"
              rules={[{ required: true, message: "Please enter your current password" }]}
            >
              <Input.Password
                placeholder="Enter current password"
                iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
              />
            </Form.Item>
          </div>
        </div>

        <div className="setting-row">
          <p className="setting-row-label">New Password</p>
          <div className="setting-row-value">
            <Form.Item
              name="newPassword"
              rules={[
                { required: true, message: "Please enter your new password" },
                { min: 8, message: "Password must be at least 8 characters" },
                { pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/, message: "Must include uppercase, lowercase, and a number" },
              ]}
              hasFeedback
            >
              <Input.Password
                placeholder="Enter new password"
                iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
              />
            </Form.Item>
          </div>
        </div>

        <div className="setting-row">
          <p className="setting-row-label">Confirm New Password</p>
          <div className="setting-row-value">
            <Form.Item
              name="confirmPassword"
              dependencies={["newPassword"]}
              hasFeedback
              rules={[
                { required: true, message: "Please confirm your new password" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    return value === getFieldValue("newPassword")
                      ? Promise.resolve()
                      : Promise.reject(new Error("Passwords do not match"));
                  },
                }),
              ]}
            >
              <Input.Password
                placeholder="Confirm new password"
                iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
              />
            </Form.Item>
          </div>
        </div>

        <div className="setting-row">
          <p className="setting-row-label"></p>
          <div className="setting-row-value">
            <div className="button-group">
              <button
                type="button"
                className="setting-chip-btn"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="setting-chip-btn setting-chip-btn--primary"
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      </Form>
    </>
  );
};
export default ChangePassword;
