import { useEffect, useState } from 'react';
import { Form, Input, Button, Row, Col, Upload, message, DatePicker, Avatar } from 'antd';
import { UploadOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import './settings.css';
import dayjs from 'dayjs';
import Navbar from '../../navbar/navbar';
import { GetUserById, UpdateUser } from '../../services/https';
import type { UserInterface } from '../../interfaces/User';

const Settings = () => {
  const [userID, setUserID] = useState<string | null>(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const calculateAge = (birthdate: dayjs.Dayjs | null): number | null => {
    if (!birthdate) return null;
    const today = dayjs();
    let age = today.year() - birthdate.year();
    if (
      today.month() < birthdate.month() ||
      (today.month() === birthdate.month() && today.date() < birthdate.date())
    ) {
      age--;
    }
    return age;
  };

  useEffect(() => {
    const id = localStorage.getItem('id');
    setUserID(id);
  }, []);

  const fetchUserData = async (userID: number) => {
    try {
      const user = await GetUserById(userID);
      if (user?.ID) {
        form.setFieldsValue({
          firstname: user.Firstname,
          lastname: user.Lastname,
          birthday: user.Birthday ? dayjs(user.Birthday) : null
        });
      } else {
        messageApi.error("ไม่พบข้อมูลผู้ใช้");
        setTimeout(() => navigate('/setting'), 2000);
      }
    } catch (error) {
      console.error("Error fetching user:", error);
      messageApi.error("เกิดข้อผิดพลาดในการดึงข้อมูล");
    } finally {
      setLoading(false);
    }
  };

  const onFinish = async (values: UserInterface) => {
    const age = calculateAge(values.Birthday ? dayjs(values.Birthday) : null) ?? 0;
    const submitData = {
      ...values,
      age,
    };

    try {
      const res = await UpdateUser(Number(userID), submitData);
      if (res.status === 200) {
        messageApi.success('บันทึกข้อมูลสำเร็จ');
        setIsEditing(false);
      } else {
        messageApi.error(`เกิดข้อผิดพลาดในการบันทึกข้อมูล (code: ${res.status})`);
      }
    } catch (error: any) {
      messageApi.error('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
      console.error("Save error:", error.message || error);
    }
  };

  useEffect(() => {
    if (userID) {
      fetchUserData(Number(userID));
    }
  }, [userID]);

  const renderButtons = () =>
    isEditing ? (
      <>
        <Button onClick={() => setIsEditing(false)}>Cancel</Button>
        <Button type="primary" htmlType="submit" style={{ marginLeft: 8 }}>
          Save
        </Button>
      </>
    ) : (
      <Button type="default" onClick={() => setIsEditing(true)}>
        Edit
      </Button>
    );

  return (
    <div className="setting-container">
      {contextHolder}
      <Navbar />
      <div className="setting-content">
        <div className="setting-head">
          <h1>Account Settings</h1>
          <p>Manage your account settings and preferences</p>
        </div>
        <div className="setting-box">
          {!loading && (
            <Form form={form} layout="vertical" className="profile-form" onFinish={onFinish}>
              <h2>Profile Info</h2>
              <Row gutter={32}>
                <Col xs={24} md={16}>
                  <Form.Item label="First Name" name="firstname">
                    {isEditing ? <Input /> : <Input disabled />}
                  </Form.Item>
                  <Form.Item label="Last Name" name="lastname">
                    {isEditing ? <Input /> : <Input disabled />}
                  </Form.Item>
                  <Form.Item label="Birthday">
                    {isEditing ? (
                      <Form.Item name="birthday" noStyle>
                        <DatePicker
                          format="YYYY-MM-DD"
                          style={{ width: '100%' }}
                          onChange={(date) => {
                            const age = calculateAge(date);
                            form.setFieldValue('birthday', date);
                            form.setFieldValue('age', age);
                          }}
                        />
                      </Form.Item>
                    ) : (
                      <Input
                        disabled
                        value={
                          form.getFieldValue('birthday')
                            ? dayjs(form.getFieldValue('birthday')).format('YYYY-MM-DD')
                            : ''
                        }
                      />
                    )}
                  </Form.Item>
                  <Form.Item label="Age">
                    {isEditing ? (
                      <Input
                        disabled
                        value={calculateAge(form.getFieldValue('birthday')) ?? ''}
                      />
                    ) : (
                      <Input
                        disabled
                        value={calculateAge(form.getFieldValue('birthday')) ?? ''}
                      />
                    )}
                  </Form.Item>
                  <div className="button-group">{renderButtons()}</div>
                </Col>
                <Col xs={24} md={8} className="avatar-section">
                  <Avatar size={128} icon={<UserOutlined />} />
                  <Upload showUploadList={false}>
                    <Button icon={<UploadOutlined />} type="text">
                      Upload a picture
                    </Button>
                  </Upload>
                </Col>
              </Row>
            </Form>
          )}
        </div>
      </div>
    </div>
  )
}

export default Settings