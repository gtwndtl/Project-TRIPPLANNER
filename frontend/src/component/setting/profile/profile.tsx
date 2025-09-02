// src/component/setting/profile/ProfileInfo.tsx
import "./profile.css";
import type { UserInterface } from "../../../interfaces/User";
import { useState } from "react";
import { Form, DatePicker, Input, Button, message } from "antd";
import dayjs, { Dayjs } from "dayjs";
import { useUserId } from "../../../hooks/useUserId";
import { UpdateUser } from "../../../services/https";

const ProfileInfo = ({ Firstname, Lastname, Age, Birthday }: UserInterface) => {
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [msg, holder] = message.useMessage();
  const userId = useUserId();

  const calcAge = (d: Dayjs | null | undefined) => {
    if (!d) return undefined;
    const today = dayjs();
    let age = today.year() - d.year();
    if (today.month() < d.month() || (today.month() === d.month() && today.date() < d.date())) {
      age -= 1;
    }
    return Math.max(age, 0);
  };

  const onFinish = async (values: any) => {
    try {
      if (!userId && userId !== 0) {
        msg.error("ไม่พบ User ID");
        return;
      }
      setSubmitting(true);

      const b: Dayjs | null = values.birthday ?? null;

      const apiPayload = {
        Firstname: values.firstname?.trim() || "",
        Lastname: values.lastname?.trim() || "",
        Birthday: b ? b.toDate().toISOString() : undefined, // ส่งเป็น ISO 8601
        Age: calcAge(b) ?? 0,
      };

      await UpdateUser(Number(userId), apiPayload);

      msg.success("Profile updated");
      // รีโหลดหน้านี้ใหม่หลังแสดงข้อความสำเร็จเล็กน้อย
      setTimeout(() => {
        window.location.reload();
      }, 800);
      // ถ้าจะไม่รีโหลด สามารถ setEditing(false) ได้ แต่เราจะรีโหลดอยู่แล้ว
      // setEditing(false);
    } catch (e: any) {
      const serverMsg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Server error";
      msg.error(serverMsg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!editing) {
    return (
      <>
        {holder}
        <h3 className="setting-section-title">Personal info</h3>

        <div className="setting-row">
          <p className="setting-row-label">First name</p>
          <div className="setting-row-value"><p>{Firstname}</p></div>
        </div>

        <div className="setting-row">
          <p className="setting-row-label">Last name</p>
          <div className="setting-row-value"><p>{Lastname}</p></div>
        </div>

        <div className="setting-row">
          <p className="setting-row-label">Date of birth</p>
          <div className="setting-row-value"><p>{Birthday}</p></div>
        </div>

        <div className="setting-row">
          <p className="setting-row-label">Age</p>
          <div className="setting-row-value"><p>{Age ?? "-"}</p></div>
        </div>

        <div className="setting-row">
          <p className="setting-row-label"></p>
          <div className="setting-row-value">
            <button className="setting-chip-btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {holder}
      <div className="change-password">
        <div className="change-password-header">
          <h3 className="setting-section-title">Edit personal info</h3>
        </div>

        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={onFinish}
          className="change-password-form"
          initialValues={{
            firstname: Firstname ?? "",
            lastname: Lastname ?? "",
            birthday: Birthday ? dayjs(Birthday) : null,
          }}
        >
          <div className="setting-row">
            <p className="setting-row-label">First name</p>
            <div className="setting-row-value">
              <Form.Item
                name="firstname"
                rules={[
                  { required: true, message: "Please enter your first name" },
                  { max: 50, message: "First name is too long" },
                ]}
              >
                <Input placeholder="Enter first name" allowClear />
              </Form.Item>
            </div>
          </div>

          <div className="setting-row">
            <p className="setting-row-label">Last name</p>
            <div className="setting-row-value">
              <Form.Item
                name="lastname"
                rules={[
                  { required: true, message: "Please enter your last name" },
                  { max: 50, message: "Last name is too long" },
                ]}
              >
                <Input placeholder="Enter last name" allowClear />
              </Form.Item>
            </div>
          </div>

          <div className="setting-row">
            <p className="setting-row-label">Date of birth</p>
            <div className="setting-row-value">
              <Form.Item
                name="birthday"
                rules={[{ required: true, message: "Please select your birth date" }]}
              >
                <DatePicker
                  style={{ width: "100%" }}
                  placeholder="Select date of birth"
                  disabledDate={(d) => d && d.isAfter(dayjs())}
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
                  onClick={() => setEditing(false)}
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
      </div>
    </>
  );
};

export default ProfileInfo;
