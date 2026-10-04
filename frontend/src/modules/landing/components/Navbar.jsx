import React, { useState } from 'react';
import { Menu, X, MapPin, ChevronDown, ArrowRight, ChevronRight } from 'lucide-react';
import { scrollToTop } from '../hooks/useSmoothScroll';

const Navbar = ({ activeTab, setActiveTab, openBookingModal }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedCity, setSelectedCity] = useState('Indiranagar, Bengaluru');
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'about', label: 'About Us' },
    { id: 'services', label: 'Services' },
    { id: 'corporate', label: 'Corporate' },
    { id: 'partner', label: 'Partner' },
    { id: 'driver', label: 'Driver' },
    { id: 'advertise', label: 'Advertise' },
    { id: 'contact', label: 'Contact Us' },
  ];

  const cities = [
    'Indiranagar, Bengaluru',
    'Koramangala, Bengaluru',
    'Whitefield, Bengaluru',
    'Hampankatta, Mangaluru',
    'Vidyanagar, Hubballi'
  ];

  const handleNavClick = (id) => {
    setActiveTab(id);
    setMobileMenuOpen(false);
    scrollToTop();
  };

  return (
    <header className="navbar-header">
      <div className="container navbar-container">
        {/* Brand Logo */}
        <div 
          className="brand-logo" 
          onClick={() => handleNavClick('home')}
          style={{ cursor: 'pointer' }}
        >
          <img src="/oho-logo.jpg" alt="OHO RIDE" className="brand-logo-img" />
          <div className="brand-logo-text">
            <div className="logo-text-wrapper">
              <span className="logo-oho">OHO</span>
              <span className="logo-ride">RIDE</span>
            </div>
            <span className="logo-tagline">FAST. RELIABLE. SAFE.</span>
          </div>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="desktop-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`nav-link-btn ${activeTab === item.id ? 'active' : ''}`}
            >
              {item.label}
              {activeTab === item.id && <span className="active-dot" />}
            </button>
          ))}
        </nav>

        {/* Action Button & Location Selector */}
        <div className="navbar-actions">
          {/* City / Area Dropdown Pill */}
          <div className="nav-location-dropdown">
            <button 
              type="button" 
              className="nav-location-pill"
              onClick={() => setCityDropdownOpen(!cityDropdownOpen)}
            >
              <MapPin size={14} color="#D90429" className="flex-shrink-0" />
              <span className="location-name">{selectedCity}</span>
              <ChevronDown size={13} color="#94A3B8" />
            </button>

            {cityDropdownOpen && (
              <div className="location-menu-dropdown">
                {cities.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`loc-option ${selectedCity === c ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedCity(c);
                      setCityDropdownOpen(false);
                    }}
                  >
                    <MapPin size={12} color="#D90429" />
                    <span>{c}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button 
            className="btn-nav-book"
            onClick={openBookingModal}
          >
            <span>Book a Ride</span>
            <ArrowRight size={15} />
          </button>

          {/* Hamburger Menu Toggle for Mobile */}
          <button 
            className="mobile-toggle-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation"
          >
            {mobileMenuOpen ? <X size={26} color="#FFFFFF" /> : <Menu size={26} color="#FFFFFF" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="mobile-drawer animate-fade-in">
          <div className="mobile-drawer-inner">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`mobile-nav-item ${activeTab === item.id ? 'active' : ''}`}
              >
                <span>{item.label}</span>
                <ChevronRight size={18} />
              </button>
            ))}
            <div className="mobile-drawer-cta">
              <button 
                className="btn btn-red w-full"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openBookingModal();
                }}
              >
                Book a Ride
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .zicab-landing {
          .navbar-header {
            background-color: rgba(11, 15, 25, 0.92);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            position: sticky;
            top: 0;
            z-index: 1000;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
          }

          .navbar-container {
            display: flex;
            align-items: center;
            justify-content: space-between;
            height: 76px;
          }

          .brand-logo {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .brand-logo-img {
            width: 48px;
            height: 48px;
            border-radius: 12px;
            object-fit: cover;
            flex-shrink: 0;
            border: 1px solid rgba(217, 4, 41, 0.35);
            box-shadow: 0 2px 10px rgba(217, 4, 41, 0.25);
          }

          .brand-logo-text {
            display: flex;
            flex-direction: column;
          }

          .logo-text-wrapper {
            display: flex;
            align-items: baseline;
            line-height: 1;
          }

          .logo-oho {
            font-size: 26px;
            font-weight: 900;
            color: #FFFFFF;
            letter-spacing: -0.5px;
          }

          .logo-ride {
            font-size: 23px;
            font-weight: 800;
            color: #D90429;
            margin-left: 4px;
            letter-spacing: 0.5px;
          }

          .logo-tagline {
            font-size: 10px;
            color: rgba(255, 255, 255, 0.65);
            font-weight: 500;
            letter-spacing: 0.4px;
            margin-top: 2px;
            text-transform: uppercase;
          }

          .desktop-nav {
            display: flex;
            align-items: center;
            gap: 20px;
          }

          .nav-link-btn {
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.85);
            font-size: 14.5px;
            font-weight: 500;
            cursor: pointer;
            padding: 8px 4px;
            position: relative;
            transition: all 0.2s ease;
          }

          .nav-link-btn:hover {
            color: #FF4D6D;
          }

          .nav-link-btn.active {
            color: #FFFFFF;
            font-weight: 600;
          }

          .active-dot {
            position: absolute;
            bottom: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 18px;
            height: 3px;
            background-color: #D90429;
            border-radius: 2px;
            box-shadow: 0 0 8px rgba(217, 4, 41, 0.8);
          }

          .navbar-actions {
            display: flex;
            align-items: center;
            gap: 14px;
          }

          .nav-location-dropdown {
            position: relative;
          }

          .nav-location-pill {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 9999px;
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 500;
            color: #E2E8F0;
            cursor: pointer;
            transition: all 0.2s;
          }

          .nav-location-pill:hover {
            background: rgba(255, 255, 255, 0.09);
            border-color: rgba(217, 4, 41, 0.4);
          }

          .location-name {
            white-space: nowrap;
          }

          .location-menu-dropdown {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            background: #0D121F;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 12px;
            padding: 6px;
            min-width: 220px;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.7);
            z-index: 1000;
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .loc-option {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            font-size: 12.5px;
            color: #CBD5E1;
            background: none;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            text-align: left;
            width: 100%;
            transition: all 0.15s;
          }

          .loc-option:hover,
          .loc-option.active {
            background: rgba(217, 4, 41, 0.14);
            color: #FFFFFF;
            font-weight: 600;
          }

          .btn-nav-book {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: linear-gradient(135deg, #EF1C38 0%, #D90429 50%, #B8001F 100%);
            color: #FFFFFF;
            font-size: 14px;
            font-weight: 700;
            padding: 9px 22px;
            border-radius: 9999px;
            border: none;
            cursor: pointer;
            box-shadow: 0 4px 18px rgba(217, 4, 41, 0.45);
            transition: all 0.2s ease;
            white-space: nowrap;
          }

          .btn-nav-book:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(217, 4, 41, 0.6);
          }

          .mobile-toggle-btn {
            display: none;
            background: none;
            border: none;
            cursor: pointer;
            padding: 6px;
          }

          .mobile-drawer {
            display: none;
            background-color: #0B0F19;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding: 16px 20px 24px;
          }

          .mobile-drawer-inner {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .mobile-nav-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.06);
            color: #FFFFFF;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 500;
            cursor: pointer;
            text-align: left;
          }

          .mobile-nav-item.active {
            background: rgba(217, 4, 41, 0.14);
            border-color: #D90429;
            color: #FF4D6D;
          }

          .mobile-drawer-cta {
            margin-top: 12px;
          }

          .w-full {
            width: 100%;
          }

          @media (max-width: 992px) {
            .desktop-nav {
              display: none;
            }
            .mobile-toggle-btn, .mobile-drawer {
              display: block;
            }
            .nav-book-btn {
              display: none;
            }
          }
      
        }
      `}</style>
    </header>
  );
};

export default Navbar;
