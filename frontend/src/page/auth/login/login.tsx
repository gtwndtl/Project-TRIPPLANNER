import { useCallback } from 'react';
import { motion } from 'framer-motion';
import './login.css';
import { Button, Divider, Form, Input, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import type { SignInInterface } from '../../../interfaces/SignIn';
import { SignInUser, CreateUser, GetAllUsers } from '../../../services/https';


const LoginPage = () => {
    const navigate = useNavigate();
    const [messageApi, contextHolder] = message.useMessage();
    const storeAuthInfo = (result: { token: string; token_type: string; id: number }) => {
        localStorage.setItem('isLogin', 'true');
        localStorage.setItem('token', result.token);
        localStorage.setItem('token_type', result.token_type);
        localStorage.setItem('id', result.id.toString());
    };

    const onFinish = useCallback(async (values: any) => {
        const signInData: SignInInterface = {
            Email: values.email,
            Password: values.password,
        };
        try {
            const result = await SignInUser(signInData);

            if (result?.token && result?.token_type) {
                storeAuthInfo(result);

                messageApi.open({
                    type: 'success',
                    content: 'เข้าสู่ระบบสำเร็จ',
                    duration: 1.2,              // ปรับได้
                    onClose: () => navigate('/'), // โชว์เสร็จค่อยไปหน้าใหม่
                });
            } else {
                messageApi.open({
                    type: 'error',
                    content: 'เกิดข้อผิดพลาด: ข้อมูลการเข้าสู่ระบบไม่ครบถ้วน',
                });
            }
        } catch (err: any) {
            messageApi.open({
                type: 'error',
                content: err?.message || 'เข้าสู่ระบบไม่สำเร็จ',
            });
        }
    }, [navigate, messageApi]);


    const handleGoogleLogin = useCallback(async (profile: any) => {
        try {
            const email = profile.email;
            const fakePassword = 'google_oauth_password';

            const users = await GetAllUsers();
            const userExists = users.some((u: any) => u.Email === email);

            if (!userExists) {
                await CreateUser({
                    Firstname: profile.given_name || 'Google',
                    Lastname: profile.family_name || 'User',
                    Email: email,
                    Password: fakePassword,
                    Birthday: new Date().toISOString(),
                    Age: 0,
                    Profile: profile.picture || '',
                    Type: 'Google',
                });
                messageApi.success('สมัครสมาชิกด้วย Google สำเร็จ');
            }

            const loginResult = await SignInUser({ Email: email, Password: fakePassword });
            if (loginResult?.token && loginResult?.token_type) {
                storeAuthInfo(loginResult);
                messageApi.open({
                    type: 'success',
                    content: 'เข้าสู่ระบบด้วย Google สำเร็จ',
                    duration: 1.2,
                    onClose: () => navigate('/'),
                });
            } else {
                messageApi.error('เข้าสู่ระบบล้มเหลว');
            }
        } catch (err) {
            console.error('Google login failed', err);
            messageApi.error('Google login ล้มเหลว');
        }
    }, [navigate, messageApi]);


    const googleLogin = useGoogleLogin({
        flow: 'implicit',
        onSuccess: async ({ access_token }) => {
            try {
                const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${access_token}` },
                });
                const profile = await res.json();
                await handleGoogleLogin(profile);
            } catch {
                message.error('Google login ล้มเหลว');
            }
        },
        onError: () => message.error('Google login ล้มเหลว'),
    });

    return (
        <div className="login-container">
            {contextHolder}
            <div className="login-page">
                <div className="login-left">
                    <div className="login-header">
                        <span className="login-title">TRIP PLANNER</span>
                    </div>
                    <div className="signup">
                        <p className="signup-text">Don't have an account?</p>
                        <a className="signup-link" onClick={() => navigate("/register")}>Sign up</a>
                    </div>
                    <Form className="login-form" name="login" onFinish={onFinish}>
                        <Form.Item
                            name="email"
                            rules={[{ type: 'email', required: true, message: 'Please input Email!' }]}
                        >
                            <Input placeholder="Email" />
                        </Form.Item>

                        <Form.Item
                            name="password"
                            rules={[{ required: true, message: 'Please input Password!' }]}
                        >
                            <Input.Password placeholder="Password" />
                        </Form.Item>
                        <a className="login-forgot" href="#">Forgot password?</a>
                        <Button htmlType="submit" className="sign-in-button continue-btn">
                            Sign In
                        </Button>
                        <Divider />
                        <div className="continue">
                            <Button onClick={() => googleLogin()} className="google-login-button continue-btn">
                                <GoogleIcon /> Continue with Google
                            </Button>
                            <Button className="apple-login-button continue-btn">
                                <AppleIcon /> Continue with Apple
                            </Button>
                        </div>
                        <div className="policy">
                            By signing up, you agree to our <a href="#">Terms of service</a> and <a href="#">Privacy Policy</a>.
                        </div>
                    </Form>
                </div>
                <motion.div
                    className="login-right"
                    initial={{ x: '-100%' }}
                    animate={{ x: 0 }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                />
            </div>
        </div>
    );
};

const AppleIcon = () => (
    <svg className="apple-icon" viewBox="0 0 1024 1024" height="1em" width="1em" fill="currentColor">
        <path d="M747.4 535.7c-.4-68.2 30.5-119.6 92.9-157.5-34.9-50-87.7-77.5-157.3-82.8-65.9-5.2-138 38.4-164.4 38.4-27.9 0-91.7-36.6-141.9-36.6C273.1 298.8 163 379.8 163 544.6c0 48.7 8.9 99 26.7 150.8 23.8 68.2 109.6 235.3 199.1 232.6 46.8-1.1 79.9-33.2 140.8-33.2 59.1 0 89.7 33.2 141.9 33.2 90.3-1.3 167.9-153.2 190.5-221.6-121.1-57.1-114.6-167.2-114.6-170.7zm-105.1-305c50.7-60.2 46.1-115 44.6-134.7-44.8 2.6-96.6 30.5-126.1 64.8-32.5 36.8-51.6 82.3-47.5 133.6 48.4 3.7 92.6-21.2 129-63.7z" />
    </svg>
);

const GoogleIcon = () => (
    <svg className="google-icon" viewBox="0 0 48 48" height="1em" width="1em">
        <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12
      c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4
      C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
        <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,
      7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
        <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,
      24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
        <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,
      5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24
      C44,22.659,43.862,21.35,43.611,20.083z" />
    </svg>
);

export default LoginPage;
