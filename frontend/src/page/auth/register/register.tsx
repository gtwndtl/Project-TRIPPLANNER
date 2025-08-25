import { motion } from 'framer-motion';
import './register.css';
import { Button, Form, Input, message } from 'antd';
import { CreateUser } from '../../../services/https';
import type { UserInterface } from '../../../interfaces/User';
import { useNavigate } from 'react-router-dom';

const RegisterPage = () => {
    const [form] = Form.useForm();
    const navigate = useNavigate();
    const onFinish = async (values: any) => {
        try {
            const newUser: UserInterface = {
                Email: values.email,
                Password: values.password,
            };
            await CreateUser(newUser);
            message.success('สมัครสมาชิกสำเร็จ!');
            form.resetFields();
        } catch (error) {
            message.error('ไม่สามารถสมัครสมาชิกได้');
            console.error('Registration Error:', error);
        }
    };

    return (
        <div className="register-container">
            <div className="login-page">
                <motion.div
                    className="login-right"
                    initial={{ x: '100%' }}
                    animate={{ x: 0 }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                />
                <div className="login-left">
                    <div className="login-header">
                        <span className="login-title">TRIP PLANNER</span>
                    </div>

                    <div className="signup">
                        <p className="signup-text">Already have an account?</p>
                        <a className="signup-link" onClick={() => navigate("/login")}>Sign In</a>
                    </div>

                    <Form className="login-form" form={form} name="register" onFinish={onFinish}>
                        <Form.Item
                            name="email"
                            rules={[{ type: 'email', required: true, message: 'Please input your Email!' }]}
                        >
                            <Input placeholder="Email" />
                        </Form.Item>

                        <Form.Item
                            name="password"
                            rules={[{ required: true, message: 'Please input your Password!' }]}
                        >
                            <Input.Password placeholder="Password" />
                        </Form.Item>

                        <Form.Item
                            name="confirmPassword"
                            dependencies={['password']}
                            rules={[
                                { required: true, message: 'Please confirm your Password!' },
                                ({ getFieldValue }) => ({
                                    validator(_, value) {
                                        if (!value || getFieldValue('password') === value) {
                                            return Promise.resolve();
                                        }
                                        return Promise.reject(new Error('Passwords do not match!'));
                                    },
                                }),
                            ]}
                        >
                            <Input.Password placeholder="Confirm Password" />
                        </Form.Item>

                        <Button htmlType="submit" className="sign-in-button continue-btn">
                            Sign Up
                        </Button>
                        <div className="policy">
                            By signing up, you agree to our <a href="#">Terms of service</a> and <a href="#">Privacy Policy</a>.
                        </div>
                    </Form>
                </div>
            </div>
        </div>
    );
};

export default RegisterPage;