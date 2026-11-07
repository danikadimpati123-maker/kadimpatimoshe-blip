import React, { useState } from 'react';
import { X, Shield, Eye, EyeOff, Loader2, Sparkles } from 'lucide-react';
import { auth, saveParentSession } from '../services/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, signOut } from 'firebase/auth';

interface AuthModalProps {
  onClose: () => void;
  onSuccess: (user: { uid: string; email: string }) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onClose, onSuccess }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const validateInputs = () => {
    // Basic email regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address.');
      return false;
    }
    
    // Disposable domain blocking
    const disposableDomains = ['mailinator.com', '10minutemail.com', 'guerrillamail.com', 'temp-mail.org', 'yopmail.com'];
    const domain = email.split('@')[1];
    if (disposableDomains.includes(domain.toLowerCase())) {
        setError('Temporary or disposable email domains are not allowed.');
        return false;
    }

    // Simple password complexity check: at least 8 characters
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateInputs()) return;

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      if (auth) {
        if (isRegistering) {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          await sendEmailVerification(cred.user);
          await signOut(auth); // Sign out to prevent unverified access
          setMessage('Account created! Please check your email to verify your account before logging in.');
          setIsSubmitting(false);
          // Do not call onSuccess or onClose
        } else {
          const cred = await signInWithEmailAndPassword(auth, email, password);
          if (!cred.user.emailVerified) {
             await signOut(auth);
             throw new Error('Please verify your email address before logging in.');
          }
          const userData = { uid: cred.user.uid, email: cred.user.email || email };
          saveParentSession(userData);
          onSuccess(userData);
          onClose();
        }
      } else {
        throw new Error('Authentication service unavailable.');
      }
    } catch (err: any) {
      console.warn('Firebase auth attempt returned:', err);
      let errorMessage = err.message || 'Authentication error.';
      if (err.code === 'auth/invalid-credential') {
        errorMessage = 'Invalid email or password. Please check your credentials or create a new account.';
      } else if (err.code === 'auth/too-many-requests') {
        errorMessage = 'Too many attempts. Please try again later.';
      } else if (err.code === 'auth/user-not-found') {
        errorMessage = 'User not found. Please create an account first.';
      } else if (err.code === 'auth/email-already-in-use') {
        errorMessage = 'This email is already registered. Please sign in instead.';
      } else if (err.code === 'auth/weak-password') {
        errorMessage = 'Password should be at least 6 characters.';
      }
      setError(errorMessage);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl border border-[#e4e9e5] p-6 max-w-sm w-full shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-5">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-2 border border-emerald-100">
            <Shield className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-extrabold text-[#202b29]">
            {isRegistering ? 'Create Parent Account' : 'Welcome to KidGuard'}
          </h3>
          <p className="text-xs text-[#71807b] mt-1">
            {isRegistering ? 'Register to manage family devices.' : 'Log in with your parent account.'}
          </p>
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {error}
          </div>
        )}
        
        {message && (
          <div className="p-3 mb-4 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
            {message}
          </div>
        )}

        {!message && (
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">Email Address</label>
            <input
              type="email"
              required
              placeholder="parent@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 px-3 text-xs bg-neutral-50 border border-[#e4e9e5] rounded-xl focus:border-[#0a9b70] focus:ring-2 focus:ring-emerald-100 outline-none text-neutral-900"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-10 px-3 pr-10 text-xs bg-neutral-50 border border-[#e4e9e5] rounded-xl focus:border-[#0a9b70] focus:ring-2 focus:ring-emerald-100 outline-none text-neutral-900"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-10 rounded-xl text-xs font-bold bg-[#0a9b70] hover:bg-[#087957] text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Please wait…
                </>
              ) : isRegistering ? (
                'Register'
              ) : (
                'Log in'
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsRegistering(!isRegistering)}
            className="w-full text-center text-xs text-[#0a9b70] hover:underline font-semibold"
          >
            {isRegistering ? 'Already have an account? Log in' : 'New to KidGuard? Create account'}
          </button>
        </form>
        )}
      </div>
    </div>
  );
};
