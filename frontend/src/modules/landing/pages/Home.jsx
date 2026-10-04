import React, { useState, useRef, useEffect } from 'react';
import {
  MapPin, Users, ArrowRight, ShieldCheck, Navigation,
  Headphones, Wallet, PhoneCall, Car, Plane, Compass,
  Briefcase, Building2, ShoppingBag, Smartphone, QrCode, ChevronRight,
  Star, BadgeCheck, Megaphone, Bike, Clock, CheckCircle2,
  Sparkles, Shield, AlertCircle, ArrowUpDown, ChevronDown, Award,
  Leaf, Search, User, ArrowLeft, Zap, X, MessageSquare, Coins
} from 'lucide-react';
import useReveal from '../hooks/useReveal';
import useTilt from '../hooks/useTilt';
import { markIntroDone } from '../hooks/introGate';
import { CONTACT, waLink, LAUNCH_CITIES } from '../siteConfig';

const POPULAR_LOCATIONS = [
  'Kempegowda Int. Airport (BLR)',
  'MG Road / Brigade Road',
  'Indiranagar 100ft Road',
  'Koramangala 5th Block',
  'Whitefield ITPL',
  'Electronic City Phase 1',
  'Majestic Railway Station',
  'HSR Layout'
];

const VEHICLE_FLEET = [
  {
    id: 'Auto',
    name: 'OHO Auto',
    category: 'budget',
    tag: 'Most Affordable',
    type: 'Auto Rickshaw',
    seats: '3 Seats',
    bags: '1 Small Bag',
    price: '₹8',
    basePrice: '₹35',
    unit: '/km',
    eta: '2-3 mins',
    desc: 'Quick, metered doorstep auto rides. Beat the traffic easily.',
    image: '/vehicles/auto.jpg',
    features: ['Doorstep Pickup', 'Standard Meter Rates', 'No Surge']
  },
  {
    id: 'Dzire',
    name: 'OHO Mini / Sedan',
    category: 'daily',
    tag: 'Top Rated Daily',
    type: 'Comfort Sedan',
    seats: '4 Seats',
    bags: '2 Luggage Bags',
    price: '₹12',
    basePrice: '₹75',
    unit: '/km',
    eta: '3-4 mins',
    desc: 'Maruti Suzuki Dzire & Hyundai Xcent with chilled AC and sanitized interiors.',
    image: '/vehicles/dzire.jpg',
    features: ['Full AC', 'Verified Captain', 'Clean Interiors']
  },
  {
    id: 'Ertiga',
    name: 'OHO Prime MUV',
    category: 'family',
    tag: 'Great For Families',
    type: 'Spacious 6-Seater',
    seats: '6 Seats',
    bags: '3 Large Bags',
    price: '₹16',
    basePrice: '₹120',
    unit: '/km',
    eta: '5-6 mins',
    desc: 'Maruti Suzuki Ertiga with ample legroom for group outings and airport drops.',
    image: '/vehicles/ertiga.jpg',
    features: ['Extra Legroom', 'Spacious Boot Space', '6 Passenger Seating']
  },
  {
    id: 'Innova Crysta',
    name: 'OHO Prime SUV',
    category: 'premium',
    tag: 'Executive Travel',
    type: 'Toyota Innova Crysta',
    seats: '6-7 Seats',
    bags: '4 Large Bags',
    price: '₹20',
    basePrice: '₹180',
    unit: '/km',
    eta: '6-8 mins',
    desc: 'Luxurious captain seats, unmatched ride comfort, ideal for long outstation trips.',
    image: '/vehicles/innova-crysta.jpg',
    features: ['Plush Captain Seats', 'High Speed Highway Ride', 'Premium AC']
  },
  {
    id: 'Toyota Fortuner',
    name: 'OHO Luxury SUV',
    category: 'premium',
    tag: 'VIP / Wedding & Events',
    type: 'Toyota Fortuner',
    seats: '7 Seats',
    bags: '5 Large Bags',
    price: '₹30',
    basePrice: '₹350',
    unit: '/km',
    eta: '10-12 mins',
    desc: 'Ultimate road presence and commanding luxury for VIP delegations and special events.',
    image: '/vehicles/fortuner.jpg',
    features: ['VIP Chauffeur', 'Leather Luxury Seats', 'Presidential Comfort']
  }
];

const FAQS = [
  {
    q: 'How do I book an OHO Ride?',
    a: 'You can book instantly using our online booking widget above, via the OHO Ride mobile app, or by simply clicking "Book a Ride". Enter your pickup and drop location, choose your vehicle, and a captain is assigned within seconds.'
  },
  {
    q: 'Does OHO Ride charge surge pricing during rain or peak hours?',
    a: 'No! Unlike traditional cab aggregators that charge 2x or 3x surge pricing, OHO Ride operates on a transparent, honest fare structure with a Zero Surge Pricing promise.'
  },
  {
    q: 'Can I pre-schedule a cab for Airport or Outstation travel?',
    a: 'Yes, you can schedule rides up to 7 days in advance. Our airport transfer service guarantees on-time pickup with flight tracking and flight delay accommodation.'
  },
  {
    q: 'What safety features are included in OHO Ride?',
    a: 'Every OHO ride comes with 24x7 live GPS tracking, in-app SOS emergency assistance, mandatory start-of-trip OTP verification, background-verified captains, and the ability to share your live ride status with friends and family.'
  },
  {
    q: 'What payment modes are accepted?',
    a: 'We support all popular payment options: UPI (Google Pay, PhonePe, Paytm), Debit/Credit Cards, Net Banking, and direct Cash to captain.'
  },
  {
    q: 'How can I join OHO Ride as a driver partner?',
    a: 'Simply click "Drive with OHO" in the navigation bar or scroll to our driver partner section. We offer zero percent commission for your first 30 days and daily payouts!'
  }
];

const Home = ({ openBookingModal, setActiveTab }) => {
  const pageRef = useRef(null);
  useReveal(pageRef);
  useTilt(pageRef);

  // Immediately mark intro as completed so nothing ever stalls
  useEffect(() => {
    markIntroDone();
  }, []);

  // Hero Booking Form State
  const [activeRideType, setActiveRideType] = useState('daily');
  const [selectedCategory, setSelectedCategory] = useState('any');
  const [pickup, setPickup] = useState('');
  const [drop, setDrop] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState('Dzire');
  const [rideSchedule, setRideSchedule] = useState('now');
  const [activeFaq, setActiveFaq] = useState(0);
  const [fleetFilter, setFleetFilter] = useState('all');

  const handleSwapLocations = () => {
    const temp = pickup;
    setPickup(drop);
    setDrop(temp);
  };

  const handleBookNow = (e) => {
    if (e) e.preventDefault();
    openBookingModal(selectedVehicle);
  };

  const handleQuickBook = (vehicleId) => {
    setSelectedVehicle(vehicleId);
    openBookingModal(vehicleId);
  };

  const filteredFleet = fleetFilter === 'all' 
    ? VEHICLE_FLEET 
    : VEHICLE_FLEET.filter(v => v.category === fleetFilter || (fleetFilter === 'daily' && (v.category === 'budget' || v.category === 'daily')));

  return (
    <div ref={pageRef} className="oho-home-root" data-reveal-root>
      {/* =========================================================================
          HERO SECTION: 1-Million-Dollar Mobility Experience
          ========================================================================= */}
      <section className="hero-section">
        {/* Background Ambience Elements */}
        <div className="hero-glow-blob hero-glow-1" aria-hidden="true" />
        <div className="hero-glow-blob hero-glow-2" aria-hidden="true" />
        <div className="hero-left-accent-ring" aria-hidden="true" />

        <div className="container hero-container">
          <div className="hero-grid">
            {/* Left Column: Booking Machine */}
            <div className="hero-booking-column">
              <div className="hero-badge-pill">
                <span className="live-pulse-dot" />
                <span className="badge-text">OHO RIDE · NEXT-GEN CAB NETWORK</span>
                <span className="badge-highlight">NOW LIVE</span>
              </div>

              <h1 className="hero-headline">
                Fast, Safe &amp; <br />
                <span className="headline-gradient">Zero-Surge Rides.</span>
              </h1>

              <p className="hero-subheading">
                Book premium city cabs, auto-rickshaws, and outstation rides with verified captains, zero cancellation worries, and transparent pricing.
              </p>

              {/* Feature Micro-Badges Row */}
              <div className="hero-feature-tags">
                <div className="feature-tag-item">
                  <ShieldCheck size={18} className="feature-tag-icon text-red" />
                  <span>Verified Captains</span>
                </div>
                <div className="feature-tag-item">
                  <span className="feature-tag-rupee">₹</span>
                  <span>No Surge Pricing</span>
                </div>
                <div className="feature-tag-item">
                  <Clock size={18} className="feature-tag-icon text-red" />
                  <span>On-Time Rides</span>
                </div>
                <div className="feature-tag-item">
                  <Leaf size={18} className="feature-tag-icon text-red" />
                  <span>Safer Cities</span>
                </div>
              </div>

              {/* Ride Booking Widget Card */}
              <div className="booking-widget-card" data-tilt>
                {/* Tabs */}
                <div className="widget-tabs">
                  <button
                    type="button"
                    onClick={() => setActiveRideType('daily')}
                    className={`widget-tab ${activeRideType === 'daily' ? 'active' : ''}`}
                  >
                    <Car size={16} />
                    <span>Daily Ride</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveRideType('auto')}
                    className={`widget-tab ${activeRideType === 'auto' ? 'active' : ''}`}
                  >
                    <Bike size={16} />
                    <span>OHO Auto</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveRideType('airport')}
                    className={`widget-tab ${activeRideType === 'airport' ? 'active' : ''}`}
                  >
                    <Plane size={16} />
                    <span>Airport Cab</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveRideType('rental')}
                    className={`widget-tab ${activeRideType === 'rental' ? 'active' : ''}`}
                  >
                    <Compass size={16} />
                    <span>Rentals / Outstation</span>
                  </button>
                </div>

                {/* Booking Inputs */}
                <form onSubmit={handleBookNow} className="widget-form">
                  <div className="route-inputs-box">
                    <div className="route-pins-indicator">
                      <span className="pin-circle pickup-circle" />
                      <span className="pin-dashed-line" />
                      <span className="pin-square drop-square" />
                    </div>

                    <div className="inputs-stack">
                      <div className="input-field-group">
                        <MapPin size={17} className="input-field-icon" />
                        <label htmlFor="pickup-loc" className="sr-only">Pickup Location</label>
                        <input
                          id="pickup-loc"
                          type="text"
                          value={pickup}
                          onChange={(e) => setPickup(e.target.value)}
                          placeholder="Enter pickup location (e.g. Indiranagar)"
                          className="widget-input"
                        />
                        <button
                          type="button"
                          className="btn-locate-me"
                          title="Use current location"
                          onClick={() => setPickup('Current Location (Detected)')}
                        >
                          <Navigation size={15} />
                        </button>
                      </div>

                      <div className="input-field-divider" />

                      <div className="input-field-group">
                        <MapPin size={17} className="input-field-icon" />
                        <label htmlFor="drop-loc" className="sr-only">Drop Location</label>
                        <input
                          id="drop-loc"
                          type="text"
                          value={drop}
                          onChange={(e) => setDrop(e.target.value)}
                          placeholder="Where do you want to go?"
                          className="widget-input"
                        />
                        <button
                          type="button"
                          className="btn-swap-locations"
                          title="Swap pickup and drop"
                          onClick={handleSwapLocations}
                        >
                          <ArrowUpDown size={15} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Ride Category Selector */}
                  <div className="category-filter-section">
                    <span className="category-filter-label">SELECT RIDE CATEGORY</span>
                    <div className="category-filter-pills">
                      <button
                        type="button"
                        onClick={() => { setSelectedCategory('any'); setSelectedVehicle('Dzire'); }}
                        className={`cat-pill ${selectedCategory === 'any' ? 'active' : ''}`}
                      >
                        Any
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSelectedCategory('sedan'); setSelectedVehicle('Dzire'); }}
                        className={`cat-pill ${selectedCategory === 'sedan' ? 'active' : ''}`}
                      >
                        <Car size={14} />
                        <span>Sedan</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSelectedCategory('suv'); setSelectedVehicle('Ertiga'); }}
                        className={`cat-pill ${selectedCategory === 'suv' ? 'active' : ''}`}
                      >
                        <Car size={14} />
                        <span>SUV</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSelectedCategory('auto'); setSelectedVehicle('Auto'); }}
                        className={`cat-pill ${selectedCategory === 'auto' ? 'active' : ''}`}
                      >
                        <Bike size={14} />
                        <span>Auto</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSelectedCategory('outstation'); setSelectedVehicle('Innova'); }}
                        className={`cat-pill ${selectedCategory === 'outstation' ? 'active' : ''}`}
                      >
                        <Compass size={14} />
                        <span>Outstation</span>
                      </button>
                    </div>
                  </div>

                  {/* Big CTA */}
                  <button type="submit" className="btn-find-ride">
                    <Search size={18} />
                    <span>Find My Ride</span>
                  </button>
                </form>
              </div>
            </div>

            {/* Right Column: Floating Status Cards & Atmosphere */}
            <div className="hero-visual-column">
              <div className="visual-stage-wrapper">
                {/* Clean Stage: Full unobstructed view of the futuristic ride and city */}

                {/* Right edge illuminated neon sign */}
                <div className="city-neon-billboard" aria-hidden="true">
                  <span>SAFER</span>
                  <span>CITIES</span>
                  <span>HAPPIER</span>
                  <span>PEOPLE</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Hero Stats Row */}
          <div className="hero-bottom-stats-row">
            <div className="bottom-stat-card">
              <div className="stat-card-icon red-glow">
                <Users size={24} />
              </div>
              <div className="stat-card-text">
                <span className="stat-number">1M+</span>
                <span className="stat-label">Happy Riders</span>
              </div>
            </div>

            <div className="bottom-stat-card">
              <div className="stat-card-icon red-glow">
                <ShieldCheck size={24} />
              </div>
              <div className="stat-card-text">
                <span className="stat-number">100%</span>
                <span className="stat-label">Verified Captains</span>
              </div>
            </div>

            <div className="bottom-stat-card">
              <div className="stat-card-icon red-glow">
                <Star size={24} />
              </div>
              <div className="stat-card-text">
                <span className="stat-number">4.8/5</span>
                <span className="stat-label">Average Rating</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          OUR RIDE OPTIONS: A Ride for Every Occasion
          ========================================================================= */}
      <section className="ride-options-section" id="fleet">
        <div className="container">
          <div className="ride-options-header">
            <div className="ride-options-title-block">
              <span className="section-eyebrow-red">OUR RIDE OPTIONS</span>
              <h2 className="ride-options-heading">
                A Ride for <span className="text-red-highlight">Every Occasion</span>
              </h2>
              <p className="ride-options-subtext">
                Choose from a wide range of safe, comfortable and affordable rides across the city.
              </p>
            </div>
            <div className="ride-options-actions">
              <button 
                type="button" 
                className="btn-view-all-cars"
                onClick={() => openBookingModal('Dzire')}
              >
                <span>View All Cars</span>
                <ArrowRight size={15} />
              </button>
              <div className="carousel-nav-buttons">
                <button type="button" className="carousel-nav-btn prev" aria-label="Previous">
                  <ArrowLeft size={16} />
                </button>
                <button type="button" className="carousel-nav-btn next" aria-label="Next">
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* 4 Cards Grid */}
          <div className="ride-cards-grid">
            {/* Card 1: OHO Auto */}
            <div className="ride-option-card">
              <div className="card-image-box">
                <img src="/vehicles/ride_auto.jpg" alt="OHO Auto" className="card-vehicle-img" />
              </div>
              <div className="card-body">
                <div className="card-name-row">
                  <div className="vehicle-icon-square">
                    <Bike size={20} />
                  </div>
                  <div className="vehicle-name-info">
                    <h3 className="v-name">OHO Auto</h3>
                    <span className="v-category">Auto Rickshaw</span>
                  </div>
                </div>
                <p className="card-description">
                  Quick, metered doorstep auto rides. Beat the traffic easily.
                </p>
                <div className="card-specs-row">
                  <div className="spec-pill"><Users size={13} /> <span>3 Seats</span></div>
                  <div className="spec-pill"><Briefcase size={13} /> <span>1 Small Bag</span></div>
                  <div className="spec-pill"><Clock size={13} /> <span>ETA 2-3 mins</span></div>
                </div>
                <div className="card-features-chips">
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> Doorstep Pickup</span>
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> Standard Meter Rates</span>
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> No Surge</span>
                </div>
                <button 
                  type="button" 
                  className="btn-book-ride-card"
                  onClick={() => { setSelectedVehicle('Auto'); openBookingModal('Auto'); }}
                >
                  <span>Book This Ride</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>

            {/* Card 2: OHO Mini / Sedan */}
            <div className="ride-option-card">
              <div className="card-image-box">
                <img src="/vehicles/ride_sedan.jpg" alt="OHO Mini / Sedan" className="card-vehicle-img" />
              </div>
              <div className="card-body">
                <div className="card-name-row">
                  <div className="vehicle-icon-square">
                    <Car size={20} />
                  </div>
                  <div className="vehicle-name-info">
                    <h3 className="v-name">OHO Mini / Sedan</h3>
                    <span className="v-category">Comfort Sedan</span>
                  </div>
                </div>
                <p className="card-description">
                  Maruti Suzuki Dzire &amp; Hyundai Xcent with chilled AC and sanitized interiors.
                </p>
                <div className="card-specs-row">
                  <div className="spec-pill"><Users size={13} /> <span>4 Seats</span></div>
                  <div className="spec-pill"><Briefcase size={13} /> <span>2 Luggage Bags</span></div>
                  <div className="spec-pill"><Clock size={13} /> <span>ETA 3-4 mins</span></div>
                </div>
                <div className="card-features-chips">
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> Full AC</span>
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> Verified Captain</span>
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> Clean Interiors</span>
                </div>
                <button 
                  type="button" 
                  className="btn-book-ride-card"
                  onClick={() => { setSelectedVehicle('Dzire'); openBookingModal('Dzire'); }}
                >
                  <span>Book This Ride</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>

            {/* Card 3: OHO Prime MUV */}
            <div className="ride-option-card">
              <div className="card-image-box">
                <img src="/vehicles/ride_ertiga.jpg" alt="OHO Prime MUV" className="card-vehicle-img" />
              </div>
              <div className="card-body">
                <div className="card-name-row">
                  <div className="vehicle-icon-square">
                    <Users size={20} />
                  </div>
                  <div className="vehicle-name-info">
                    <h3 className="v-name">OHO Prime MUV</h3>
                    <span className="v-category">Spacious 6-Seater</span>
                  </div>
                </div>
                <p className="card-description">
                  Maruti Suzuki Ertiga with ample legroom for group outings and airport drops.
                </p>
                <div className="card-specs-row">
                  <div className="spec-pill"><Users size={13} /> <span>6 Seats</span></div>
                  <div className="spec-pill"><Briefcase size={13} /> <span>3 Large Bags</span></div>
                  <div className="spec-pill"><Clock size={13} /> <span>ETA 5-6 mins</span></div>
                </div>
                <div className="card-features-chips">
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> Extra Legroom</span>
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> Spacious Boot Space</span>
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> 6 Passenger Seating</span>
                </div>
                <button 
                  type="button" 
                  className="btn-book-ride-card"
                  onClick={() => { setSelectedVehicle('Ertiga'); openBookingModal('Ertiga'); }}
                >
                  <span>Book This Ride</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>

            {/* Card 4: OHO Prime SUV */}
            <div className="ride-option-card">
              <div className="card-image-box">
                <img src="/vehicles/ride_innova.jpg" alt="OHO Prime SUV" className="card-vehicle-img" />
              </div>
              <div className="card-body">
                <div className="card-name-row">
                  <div className="vehicle-icon-square">
                    <Award size={20} />
                  </div>
                  <div className="vehicle-name-info">
                    <h3 className="v-name">OHO Prime SUV</h3>
                    <span className="v-category">Toyota Innova Crysta</span>
                  </div>
                </div>
                <p className="card-description">
                  Luxurious captain seats, unmatched ride comfort, ideal for long outstation trips.
                </p>
                <div className="card-specs-row">
                  <div className="spec-pill"><Users size={13} /> <span>6-7 Seats</span></div>
                  <div className="spec-pill"><Briefcase size={13} /> <span>4 Large Bags</span></div>
                  <div className="spec-pill"><Clock size={13} /> <span>ETA 6-8 mins</span></div>
                </div>
                <div className="card-features-chips">
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> Plush Captain Seats</span>
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> High Speed Highway Ride</span>
                  <span className="feat-badge"><CheckCircle2 size={13} className="feat-check-red" /> Premium AC</span>
                </div>
                <button 
                  type="button" 
                  className="btn-book-ride-card"
                  onClick={() => { setSelectedVehicle('Innova Crysta'); openBookingModal('Innova Crysta'); }}
                >
                  <span>Book This Ride</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Trust & Brand Strip */}
          <div className="ride-options-trust-strip">
            <div className="trust-strip-item">
              <div className="trust-icon-wrap red-pulse-subtle">
                <ShieldCheck size={20} />
              </div>
              <div className="trust-text">
                <span className="trust-title">Verified Captains</span>
                <span className="trust-sub">Your safety, our priority</span>
              </div>
            </div>

            <div className="trust-strip-item">
              <div className="trust-icon-wrap red-pulse-subtle">
                <span className="rupee-char">₹</span>
              </div>
              <div className="trust-text">
                <span className="trust-title">No Surge Pricing</span>
                <span className="trust-sub">Fair and transparent fares</span>
              </div>
            </div>

            <div className="trust-strip-item">
              <div className="trust-icon-wrap red-pulse-subtle">
                <Clock size={20} />
              </div>
              <div className="trust-text">
                <span className="trust-title">On-Time Rides</span>
                <span className="trust-sub">Reach on time, always</span>
              </div>
            </div>

            <div className="trust-strip-item">
              <div className="trust-icon-wrap red-pulse-subtle">
                <Leaf size={20} />
              </div>
              <div className="trust-text">
                <span className="trust-title">Safer Cities</span>
                <span className="trust-sub">Together for a better tomorrow</span>
              </div>
            </div>

            <div className="trust-strip-branding">
              <span className="slogan-white">Better Rides.</span>
              <span className="slogan-red">Brighter Cities.</span>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          WHY RIDE WITH OHO: The OHO Ride Difference
          ========================================================================= */}
      <section className="why-ride-section" id="why-oho">
        <div className="container">
          <div className="why-ride-header text-center">
            <div className="why-badge-pill">
              <span className="why-red-dot" />
              <span>WHY RIDE WITH OHO</span>
            </div>
            <h2 className="why-ride-heading">
              The OHO Ride <span className="why-red-highlight">Difference</span>
            </h2>
            <p className="why-ride-subtext">
              We're rebuilding ride-hailing from the ground up to solve the real everyday frustrations of commuters in India.
            </p>
          </div>

          <div className="why-cards-grid">
            {/* Card 01: Zero Driver Cancellations */}
            <div className="why-card">
              <div className="why-card-top">
                <div className="why-icon-box glow-red">
                  <X size={24} />
                </div>
                <span className="why-number">01</span>
              </div>
              <h3 className="why-card-title">Zero Driver Cancellations</h3>
              <p className="why-card-desc">
                Tired of drivers asking "Where do you want to go?" and cancelling? OHO captains are incentivized with fair pay and committed routes.
              </p>
              <div className="why-bottom-pill">
                <CheckCircle2 size={13} className="text-red" />
                <span>Committed rides, every time.</span>
              </div>
            </div>

            {/* Card 02: Zero Surge Pricing */}
            <div className="why-card">
              <div className="why-card-top">
                <div className="why-icon-box glow-red">
                  <Coins size={24} />
                </div>
                <span className="why-number">02</span>
              </div>
              <h3 className="why-card-title">Zero Surge Pricing</h3>
              <p className="why-card-desc">
                No 2.5x surge pricing when it starts drizzling or at rush hour. You pay fair, transparent fares — the same predictable rates, every single time.
              </p>
              <div className="why-bottom-pill">
                <span className="rupee-icon-small">₹</span>
                <span>Fair fares, always.</span>
              </div>
            </div>

            {/* Card 03: 24x7 Safety & In-App SOS */}
            <div className="why-card">
              <div className="why-card-top">
                <div className="why-icon-box glow-red">
                  <Shield size={24} />
                </div>
                <span className="why-number">03</span>
              </div>
              <h3 className="why-card-title">24×7 Safety &amp; In-App SOS</h3>
              <p className="why-card-desc">
                Every ride is tracked via live GPS telemetry. Tag our SOS button anytime to instantly alert emergency services and our 24×7 dispatch team.
              </p>
              <div className="why-bottom-pill">
                <Zap size={13} className="text-red" fill="currentColor" />
                <span>Your safety, our priority.</span>
              </div>
            </div>

            {/* Card 04: 30-Second Human Support */}
            <div className="why-card">
              <div className="why-card-top">
                <div className="why-icon-box glow-red">
                  <Headphones size={24} />
                </div>
                <span className="why-number">04</span>
              </div>
              <h3 className="why-card-title">30-Second Human Support</h3>
              <p className="why-card-desc">
                No frustrating chatbot loops. Get connected to a real human support executive on call or WhatsApp within 30 seconds.
              </p>
              <div className="why-bottom-pill">
                <MessageSquare size={13} className="text-red" />
                <span>Real people. Real support.</span>
              </div>
            </div>
          </div>

          {/* Bottom Accent Banner */}
          <div className="why-bottom-divider">
            <div className="divider-line" />
            <span className="divider-tag">BETTER RIDES, BRIGHTER CITIES.</span>
            <div className="divider-line" />
          </div>
        </div>
      </section>

      {/* =========================================================================
          HOW IT WORKS: 3-Step Seamless Booking
          ========================================================================= */}
      <section className="steps-section">
        <div className="container">
          <div className="section-title-wrap text-center">
            <div className="eyebrow-red justify-center">
              <span className="eyebrow-dot" />
              <span>SEAMLESS EXPERIENCE</span>
            </div>
            <h2 className="section-heading">How OHO Ride Works</h2>
            <p className="section-subtext">Book a ride in less than 30 seconds with 3 simple steps.</p>
          </div>

          <div className="steps-grid">
            <div className="step-card">
              <div className="step-number-bubble">01</div>
              <div className="step-illustration">
                <Navigation size={36} className="text-red" />
              </div>
              <h3>Set Your Route</h3>
              <p>Enter your pickup point or tap current location, and select your destination.</p>
            </div>

            <div className="step-card">
              <div className="step-number-bubble">02</div>
              <div className="step-illustration">
                <Car size={36} className="text-red" />
              </div>
              <h3>Choose Your Vehicle</h3>
              <p>Compare transparent fares between Auto, Sedans, and SUVs with guaranteed ETAs.</p>
            </div>

            <div className="step-card">
              <div className="step-number-bubble">03</div>
              <div className="step-illustration">
                <Award size={36} className="text-red" />
              </div>
              <h3>Enjoy Your Trip</h3>
              <p>Share your OTP with the verified captain, track the ride live, and pay cashless.</p>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          DRIVER PARTNER RECRUITMENT BANNER
          ========================================================================= */}
      <section className="driver-banner-section">
        <div className="container">
          <div className="driver-banner-card">
            <div className="driver-banner-grid">
              <div className="driver-content-col">
                <div className="banner-badge">DRIVE WITH OHO · EARN MORE</div>
                <h2 className="banner-title">
                  Earn Up to <span className="text-highlight">₹45,000+</span> Monthly.
                </h2>
                <p className="banner-desc">
                  Join 15,000+ happy captains. Enjoy 0% commission for your first 30 days, daily UPI bank payouts, and 24x7 driver care support.
                </p>

                <div className="driver-perks-row">
                  <div className="perk-item">
                    <CheckCircle2 size={16} className="text-red-vibrant" />
                    <span>0% Commission (1st Month)</span>
                  </div>
                  <div className="perk-item">
                    <CheckCircle2 size={16} className="text-red-vibrant" />
                    <span>Instant Daily UPI Payouts</span>
                  </div>
                  <div className="perk-item">
                    <CheckCircle2 size={16} className="text-red-vibrant" />
                    <span>Flexible Working Hours</span>
                  </div>
                </div>

                <div className="banner-cta-group">
                  <button 
                    type="button" 
                    onClick={() => setActiveTab('driver')}
                    className="btn-driver-cta"
                  >
                    <span>Register as Captain Now</span>
                    <ArrowRight size={18} />
                  </button>
                  <a
                    href={waLink("Hi OHO Ride, I'd like to attach my cab/auto as a driver partner.")}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-driver-wa"
                  >
                    <span>Chat on WhatsApp</span>
                  </a>
                </div>
              </div>

              <div className="driver-stats-col">
                <div className="driver-stat-card">
                  <span className="stat-big-num">15,000+</span>
                  <span className="stat-label">Verified Captains</span>
                </div>
                <div className="driver-stat-card">
                  <span className="stat-big-num">₹2.8 Cr+</span>
                  <span className="stat-label">Paid to Drivers Monthly</span>
                </div>
                <div className="driver-stat-card">
                  <span className="stat-big-num">4.9★</span>
                  <span className="stat-label">Driver Satisfaction Score</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          MOBILE APP EXPERIENCE: Download Mockup
          ========================================================================= */}
      <section className="app-download-section">
        <div className="container">
          <div className="app-download-box">
            <div className="app-grid">
              <div className="app-text-col">
                <div className="eyebrow-red">
                  <span className="eyebrow-dot" />
                  <span>MOBILE APP</span>
                </div>
                <h2 className="app-heading">Carry First-Class Travel in Your Pocket</h2>
                <p className="app-subtext">
                  Get the fastest booking experience, live vehicle map radar, real-time driver tracking, and exclusive discounts only on the OHO Ride App.
                </p>

                <div className="app-features-mini">
                  <div className="app-feature-row">
                    <div className="feat-icon-bubble">⚡</div>
                    <div>
                      <strong>One-Tap Instant Booking</strong>
                      <p>Saved home &amp; work shortcuts for lightning-quick morning bookings.</p>
                    </div>
                  </div>
                  <div className="app-feature-row">
                    <div className="feat-icon-bubble">🛡️</div>
                    <div>
                      <strong>Live Ride Sharing</strong>
                      <p>Automated WhatsApp tracking links sent to your family with one tap.</p>
                    </div>
                  </div>
                  <div className="app-feature-row">
                    <div className="feat-icon-bubble">🎁</div>
                    <div>
                      <strong>Flat ₹50 Off on First 3 Rides</strong>
                      <p>Use promo code <strong>OHOFIRST</strong> during checkout in app.</p>
                    </div>
                  </div>
                </div>

                <div className="download-buttons-group">
                  <div className="store-badge-card">
                    <span className="badge-small">GET IT ON</span>
                    <span className="badge-big">Google Play</span>
                  </div>
                  <div className="store-badge-card">
                    <span className="badge-small">DOWNLOAD ON THE</span>
                    <span className="badge-big">App Store</span>
                  </div>
                </div>
              </div>

              <div className="app-mockup-col">
                <div className="phone-mockup-frame">
                  <div className="mockup-screen-header">
                    <div className="screen-notch" />
                    <div className="mockup-brand-row">
                      <img src="/oho-logo.jpg" alt="OHO" className="mockup-logo" />
                      <span className="mockup-brand-title">OHO RIDE</span>
                    </div>
                  </div>
                  <div className="mockup-screen-body">
                    <div className="mockup-radar-box">
                      <div className="radar-circle-1" />
                      <div className="radar-circle-2" />
                      <div className="radar-car-dot" />
                      <div className="radar-rider-dot" />
                      <span className="radar-label">3 Cabs nearby · 2 min ETA</span>
                    </div>
                    <div className="mockup-ride-card">
                      <div className="mockup-car-thumb">
                        <Car size={24} className="text-red" />
                      </div>
                      <div className="mockup-car-info">
                        <strong>OHO Prime Sedan</strong>
                        <span>Dzire AC · ₹149</span>
                      </div>
                      <button type="button" className="mockup-book-btn">Book</button>
                    </div>
                  </div>
                </div>

                {/* QR Code Card */}
                <div className="qr-scan-card">
                  <div className="qr-box">
                    <QrCode size={52} className="text-dark" />
                  </div>
                  <div className="qr-info">
                    <strong>Scan to Download</strong>
                    <span>iOS &amp; Android App</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          LIVE STATS & SOCIAL PROOF
          ========================================================================= */}
      <section className="stats-section">
        <div className="container">
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-number">500,000+</span>
              <span className="stat-title">Completed Safe Rides</span>
              <span className="stat-sub">Across 3 major cities</span>
            </div>
            <div className="stat-card">
              <span className="stat-number">15,000+</span>
              <span className="stat-title">Verified Captains</span>
              <span className="stat-sub">Background &amp; police checked</span>
            </div>
            <div className="stat-card">
              <span className="stat-number">99.4%</span>
              <span className="stat-title">On-Time Arrival</span>
              <span className="stat-sub">Average pickup in 3.2 mins</span>
            </div>
            <div className="stat-card">
              <span className="stat-number">4.9 ★</span>
              <span className="stat-title">App Store &amp; Play Rating</span>
              <span className="stat-sub">From 50,000+ user reviews</span>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          CUSTOMER REVIEWS / TESTIMONIALS
          ========================================================================= */}
      <section className="testimonials-section">
        <div className="container">
          <div className="section-title-wrap text-center">
            <div className="eyebrow-red justify-center">
              <span className="eyebrow-dot" />
              <span>TESTIMONIALS</span>
            </div>
            <h2 className="section-heading">Loved by Daily Commuters</h2>
            <p className="section-subtext">Hear what real riders have to say about their OHO journey.</p>
          </div>

          <div className="testimonials-grid">
            <div className="testi-card">
              <div className="testi-stars">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={15} fill="#FFB703" color="#FFB703" />
                ))}
              </div>
              <p className="testi-quote">
                "I travel from Whitefield to Kempegowda Airport twice every week. With other apps I faced constant cancellations. OHO Ride's pre-scheduled cabs arrive 10 minutes early every single time."
              </p>
              <div className="testi-author">
                <div className="author-avatar red-gradient">AK</div>
                <div>
                  <strong>Ananya Kulkarni</strong>
                  <span>Senior Product Manager, Bengaluru</span>
                </div>
              </div>
            </div>

            <div className="testi-card">
              <div className="testi-stars">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={15} fill="#FFB703" color="#FFB703" />
                ))}
              </div>
              <p className="testi-quote">
                "Zero surge pricing during evening rains is a lifesaver. The captain was polite, the car was spotless, and the in-app live tracking gave my family peace of mind."
              </p>
              <div className="testi-author">
                <div className="author-avatar red-gradient">RS</div>
                <div>
                  <strong>Rahul Sharma</strong>
                  <span>Software Architect, Koramangala</span>
                </div>
              </div>
            </div>

            <div className="testi-card">
              <div className="testi-stars">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={15} fill="#FFB703" color="#FFB703" />
                ))}
              </div>
              <p className="testi-quote">
                "Booked an OHO Innova Crysta for a family trip to Coorg. The pricing was completely upfront with zero hidden charges. Highly recommended for family outstation travel!"
              </p>
              <div className="testi-author">
                <div className="author-avatar red-gradient">VP</div>
                <div>
                  <strong>Vijay Patil</strong>
                  <span>Business Owner, Hubballi</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          FAQ ACCORDION
          ========================================================================= */}
      <section className="faq-section">
        <div className="container">
          <div className="section-title-wrap text-center">
            <div className="eyebrow-red justify-center">
              <span className="eyebrow-dot" />
              <span>HAVE QUESTIONS?</span>
            </div>
            <h2 className="section-heading">Frequently Asked Questions</h2>
            <p className="section-subtext">Everything you need to know about booking and riding with OHO Ride.</p>
          </div>

          <div className="faq-accordion-list">
            {FAQS.map((faq, index) => {
              const isOpen = activeFaq === index;
              return (
                <div key={index} className={`faq-accordion-item ${isOpen ? 'active' : ''}`}>
                  <button
                    type="button"
                    onClick={() => setActiveFaq(isOpen ? -1 : index)}
                    className="faq-question-btn"
                  >
                    <span>{faq.q}</span>
                    <ChevronDown size={20} className={`faq-chevron ${isOpen ? 'rotate' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="faq-answer-body">
                      <p>{faq.a}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* =========================================================================
          HIGH-CONVERTING BOTTOM CTA BANNER
          ========================================================================= */}
      <section className="bottom-cta-section">
        <div className="container">
          <div className="bottom-cta-banner">
            <div className="cta-glow-bg" />
            <div className="cta-content">
              <h2 className="cta-headline">Ready for a Ride Without Surprises?</h2>
              <p className="cta-sub">
                Book your first ride with OHO Ride today and experience punctual, safe, and transparent travel.
              </p>
              <div className="cta-buttons">
                <button
                  type="button"
                  onClick={() => openBookingModal()}
                  className="btn-cta-primary"
                >
                  <span>Book an OHO Ride Now</span>
                  <ArrowRight size={18} />
                </button>
                <a
                  href={waLink()}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-cta-outline"
                >
                  <PhoneCall size={18} />
                  <span>Book via WhatsApp</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SCOPED STYLING: 1-Million-Dollar Aesthetics & OHO Brand Red
          ========================================================================= */}
      <style>{`
        .oho-home-root {
          background-color: #07090F;
          color: #F1F5F9;
          font-family: 'Outfit', 'Plus Jakarta Sans', sans-serif;
          overflow-x: hidden;
        }

        /* Ambient Glow & Utility */
        .text-red { color: #D90429; }
        .text-red-vibrant { color: #FF2E4D; }
        .text-highlight { color: #FF4D6D; }
        .eyebrow-red {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #FF2E4D;
          margin-bottom: 12px;
        }
        .eyebrow-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #D90429;
          box-shadow: 0 0 8px #FF2E4D;
        }

        /* ---------------- HERO SECTION ---------------- */
        /* ---------------- HERO SECTION ---------------- */
        .hero-section {
          position: relative;
          min-height: 820px;
          padding: 50px 0 60px;
          background-image: 
            linear-gradient(90deg, #07090E 0%, rgba(7, 9, 14, 0.96) 38%, rgba(7, 9, 14, 0.4) 62%, rgba(7, 9, 14, 0.1) 80%, rgba(7, 9, 14, 0.5) 100%),
            url('/oho_hero_bg.jpg');
          background-position: center right;
          background-size: cover;
          background-repeat: no-repeat;
          overflow: hidden;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .hero-left-accent-ring {
          position: absolute;
          bottom: 30px;
          left: -120px;
          width: 300px;
          height: 300px;
          border-radius: 50%;
          border: 3px solid rgba(255, 26, 53, 0.7);
          box-shadow: 0 0 40px rgba(255, 26, 53, 0.4), inset 0 0 30px rgba(255, 26, 53, 0.2);
          pointer-events: none;
          z-index: 1;
        }

        .hero-grid {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 48px;
          align-items: center;
          position: relative;
          z-index: 2;
        }

        .hero-badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 26, 53, 0.12);
          border: 1px solid rgba(255, 26, 53, 0.35);
          padding: 6px 14px;
          border-radius: 9999px;
          margin-bottom: 20px;
        }
        .live-pulse-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #22C55E;
          box-shadow: 0 0 10px #22C55E;
          animation: pulseGreen 2s infinite;
        }
        @keyframes pulseGreen {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.7; }
        }
        .badge-text {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: #CBD5E1;
        }
        .badge-highlight {
          font-size: 9.5px;
          font-weight: 800;
          color: #FFFFFF;
          background: #FF1A35;
          padding: 2px 7px;
          border-radius: 9999px;
          letter-spacing: 0.05em;
        }

        .hero-headline {
          font-size: clamp(2.4rem, 2rem + 2.5vw, 4.2rem);
          font-weight: 900;
          line-height: 1.05;
          letter-spacing: -0.03em;
          color: #FFFFFF;
          margin-bottom: 18px;
        }
        .headline-gradient {
          color: #FF1A35;
          text-shadow: 0 0 30px rgba(255, 26, 53, 0.4);
        }

        .hero-subheading {
          font-size: clamp(1rem, 0.95rem + 0.3vw, 1.15rem);
          line-height: 1.6;
          color: #94A3B8;
          margin-bottom: 22px;
          max-width: 580px;
        }

        /* Feature Micro-Tags Row */
        .hero-feature-tags {
          display: flex;
          align-items: center;
          gap: 24px;
          margin-bottom: 28px;
          flex-wrap: wrap;
        }
        .feature-tag-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13.5px;
          font-weight: 600;
          color: #E2E8F0;
        }
        .feature-tag-icon {
          color: #FF1A35;
        }
        .feature-tag-rupee {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: rgba(255, 26, 53, 0.15);
          border: 1.5px solid #FF1A35;
          color: #FF1A35;
          font-size: 13px;
          font-weight: 800;
        }

        /* Booking Widget Card */
        .booking-widget-card {
          background: rgba(13, 17, 26, 0.88);
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(20px);
          border-radius: 20px;
          padding: 22px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
          max-width: 560px;
        }

        .widget-tabs {
          display: flex;
          gap: 6px;
          background: rgba(8, 10, 16, 0.7);
          padding: 5px;
          border-radius: 12px;
          margin-bottom: 18px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          overflow-x: auto;
        }
        .widget-tab {
          flex: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px 12px;
          font-size: 13px;
          font-weight: 600;
          color: #94A3B8;
          border-radius: 8px;
          background: none;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
        }
        .widget-tab:hover {
          color: #FFFFFF;
        }
        .widget-tab.active {
          background: #FF1A35;
          color: #FFFFFF;
          box-shadow: 0 4px 14px rgba(255, 26, 53, 0.45);
        }

        /* Route Inputs Box */
        .route-inputs-box {
          background: rgba(8, 10, 16, 0.75);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 18px;
        }
        .route-pins-indicator {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 4px 0;
        }
        .pin-circle {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2.5px solid #22C55E;
          background: transparent;
        }
        .pin-dashed-line {
          width: 2px;
          height: 24px;
          background: repeating-linear-gradient(to bottom, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.3) 3px, transparent 3px, transparent 6px);
        }
        .pin-square {
          width: 10px;
          height: 10px;
          border-radius: 2px;
          background: #FF1A35;
        }

        .inputs-stack {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .input-field-group {
          position: relative;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .input-field-icon {
          color: #64748B;
          flex-shrink: 0;
        }
        .input-field-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.06);
          margin: 4px 0;
        }
        .widget-input {
          width: 100%;
          background: none;
          border: none;
          font-size: 14px;
          color: #FFFFFF;
          outline: none;
          padding: 6px 36px 6px 0;
        }
        .widget-input::placeholder {
          color: #64748B;
        }
        .btn-locate-me,
        .btn-swap-locations {
          position: absolute;
          right: 0;
          background: none;
          border: none;
          color: #94A3B8;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          transition: all 0.2s ease;
        }
        .btn-locate-me:hover,
        .btn-swap-locations:hover {
          color: #FF1A35;
        }

        /* Ride Category Filter */
        .category-filter-section {
          margin-bottom: 20px;
        }
        .category-filter-label {
          display: block;
          font-size: 11px;
          font-weight: 700;
          color: #64748B;
          letter-spacing: 0.08em;
          margin-bottom: 10px;
        }
        .category-filter-pills {
          display: flex;
          gap: 8px;
          overflow-x: auto;
        }
        .cat-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          color: #94A3B8;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .cat-pill:hover {
          color: #FFFFFF;
          border-color: rgba(255, 26, 53, 0.4);
        }
        .cat-pill.active {
          background: rgba(255, 26, 53, 0.15);
          border-color: #FF1A35;
          color: #FFFFFF;
          box-shadow: 0 0 12px rgba(255, 26, 53, 0.25);
        }

        /* Big CTA */
        .btn-find-ride {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 15px 24px;
          font-size: 16px;
          font-weight: 700;
          color: #FFFFFF;
          background: #FF1A35;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          box-shadow: 0 8px 24px rgba(255, 26, 53, 0.4);
          transition: all 0.25s ease;
        }
        .btn-find-ride:hover {
          background: #E0102B;
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(255, 26, 53, 0.55);
        }

        /* Visual Column & Floating Elements */
        .hero-visual-column {
          position: relative;
          min-height: 480px;
        }
        .visual-stage-wrapper {
          position: relative;
          width: 100%;
          height: 100%;
          min-height: 480px;
        }

        .floating-card {
          background: rgba(14, 20, 30, 0.88);
          border: 1px solid rgba(255, 255, 255, 0.14);
          backdrop-filter: blur(16px);
          border-radius: 16px;
          padding: 14px 18px;
          display: flex;
          align-items: center;
          gap: 14px;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
          z-index: 10;
        }
        .float-card-captain {
          position: absolute;
          top: 10px;
          right: 20px;
          min-width: 250px;
          animation: floatSlow 4s ease-in-out infinite alternate;
        }
        .float-avatar-box {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: #15803D;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .float-row-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .float-title {
          font-size: 13px;
          font-weight: 700;
          color: #FFFFFF;
        }
        .live-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #22C55E;
          box-shadow: 0 0 8px #22C55E;
        }
        .float-row-sub {
          font-size: 12px;
          color: #94A3B8;
          margin: 2px 0 6px;
        }
        .star-rating {
          color: #F59E0B;
          margin-left: 6px;
        }
        .float-progress-track {
          width: 100%;
          height: 3px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 6px;
        }
        .float-progress-fill {
          width: 75%;
          height: 100%;
          background: #22C55E;
          border-radius: 3px;
        }
        .float-row-eta {
          font-size: 12px;
          font-weight: 700;
          color: #22C55E;
        }

        .float-card-safety {
          position: absolute;
          bottom: 30px;
          left: 10px;
          animation: floatSlow 4s ease-in-out infinite alternate 2s;
        }
        .float-shield-box {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: rgba(255, 26, 53, 0.15);
          border: 1px solid rgba(255, 26, 53, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .float-title-large {
          display: block;
          font-size: 14px;
          font-weight: 700;
          color: #FFFFFF;
        }
        .float-desc-sub {
          display: block;
          font-size: 12px;
          color: #94A3B8;
        }

        .city-neon-billboard {
          position: absolute;
          right: -10px;
          top: 30px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 0.16em;
          color: #FF1A35;
          text-shadow: 0 0 14px rgba(255, 26, 53, 0.8), 0 0 28px rgba(255, 26, 53, 0.4);
          opacity: 0.85;
          pointer-events: none;
        }

        @keyframes floatSlow {
          from { transform: translateY(0px); }
          to { transform: translateY(-8px); }
        }

        /* Bottom Hero Stats Row */
        .hero-bottom-stats-row {
          display: flex;
          align-items: center;
          gap: 56px;
          margin-top: 50px;
          padding-top: 30px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          position: relative;
          z-index: 2;
        }
        .bottom-stat-card {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .stat-card-icon.red-glow {
          color: #FF1A35;
        }
        .stat-number {
          display: block;
          font-size: 24px;
          font-weight: 900;
          color: #FFFFFF;
          line-height: 1.1;
        }
        .stat-label {
          display: block;
          font-size: 12px;
          color: #94A3B8;
          font-weight: 500;
        }
        .float-text {
          display: flex;
          flex-direction: column;
        }
        .float-title {
          font-size: 13px;
          font-weight: 700;
          color: #FFFFFF;
        }
        .float-desc {
          font-size: 11px;
          color: #94A3B8;
        }
        .float-eta {
          font-size: 11px;
          font-weight: 700;
          color: #22C55E;
          margin-top: 2px;
        }
        .float-rating {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: #CBD5E1;
          font-weight: 600;
          margin-top: 2px;
        }

        .floating-pill {
          position: absolute;
          bottom: -15px;
          background: rgba(11, 15, 25, 0.95);
          border: 1px solid rgba(217, 4, 41, 0.35);
          padding: 8px 18px;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 700;
          color: #FFFFFF;
          display: flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
        }
        .pulse-beacon {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #D90429;
          box-shadow: 0 0 10px #D90429;
          animation: pulseGreen 1.5s infinite;
        }

        /* ---------------- RIDE OPTIONS SECTION (A Ride for Every Occasion) ---------------- */
        .ride-options-section {
          padding: 80px 0 60px;
          background: #07090E;
          position: relative;
        }
        .ride-options-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 36px;
          flex-wrap: wrap;
          gap: 20px;
        }
        .section-eyebrow-red {
          display: block;
          font-size: 11.5px;
          font-weight: 800;
          color: #FF1A35;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .ride-options-heading {
          font-size: clamp(2rem, 1.6rem + 1.8vw, 3rem);
          font-weight: 900;
          color: #FFFFFF;
          margin-bottom: 8px;
          letter-spacing: -0.02em;
        }
        .text-red-highlight {
          color: #FF1A35;
        }
        .ride-options-subtext {
          font-size: 14.5px;
          color: #94A3B8;
          max-width: 580px;
        }
        .ride-options-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .btn-view-all-cars {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 26, 53, 0.12);
          border: 1px solid rgba(255, 26, 53, 0.4);
          color: #FFFFFF;
          font-size: 13px;
          font-weight: 700;
          padding: 10px 20px;
          border-radius: 9999px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .btn-view-all-cars:hover {
          background: #FF1A35;
          box-shadow: 0 4px 16px rgba(255, 26, 53, 0.4);
          transform: translateY(-2px);
        }
        .carousel-nav-buttons {
          display: flex;
          gap: 8px;
        }
        .carousel-nav-btn {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #CBD5E1;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .carousel-nav-btn:hover {
          background: rgba(255, 26, 53, 0.2);
          border-color: #FF1A35;
          color: #FFFFFF;
        }

        .ride-cards-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
          margin-bottom: 30px;
        }
        @media (max-width: 1200px) {
          .ride-cards-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 640px) {
          .ride-cards-grid {
            grid-template-columns: 1fr;
          }
        }

        .ride-option-card {
          background: #0C101A;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          transition: all 0.3s cubic-bezier(0.16, 0.84, 0.28, 1);
        }
        .ride-option-card:hover {
          border-color: rgba(255, 26, 53, 0.5);
          transform: translateY(-6px);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(255, 26, 53, 0.15);
        }
        .card-image-box {
          position: relative;
          width: 100%;
          height: 180px;
          overflow: hidden;
          background: #080A10;
        }
        .card-vehicle-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transition: transform 0.5s ease;
        }
        .ride-option-card:hover .card-vehicle-img {
          transform: scale(1.05);
        }
        .card-body {
          padding: 20px;
          display: flex;
          flex-direction: column;
          flex: 1;
        }
        .card-name-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }
        .vehicle-icon-square {
          width: 42px;
          height: 42px;
          border-radius: 10px;
          background: rgba(255, 26, 53, 0.12);
          border: 1px solid rgba(255, 26, 53, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FF1A35;
          flex-shrink: 0;
        }
        .vehicle-name-info .v-name {
          font-size: 16px;
          font-weight: 800;
          color: #FFFFFF;
          line-height: 1.2;
        }
        .vehicle-name-info .v-category {
          font-size: 12px;
          color: #94A3B8;
        }
        .card-description {
          font-size: 12.5px;
          color: #94A3B8;
          line-height: 1.5;
          margin-bottom: 14px;
          min-height: 38px;
        }
        .card-specs-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 0;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          margin-bottom: 14px;
        }
        .spec-pill {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: #CBD5E1;
        }
        .card-features-chips {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 18px;
        }
        .feat-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          color: #E2E8F0;
        }
        .feat-check-red {
          color: #FF1A35;
          flex-shrink: 0;
        }
        .btn-book-ride-card {
          margin-top: auto;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px;
          font-size: 14px;
          font-weight: 700;
          color: #FFFFFF;
          background: #FF1A35;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 14px rgba(255, 26, 53, 0.35);
        }
        .btn-book-ride-card:hover {
          background: #E0102B;
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(255, 26, 53, 0.55);
        }

        /* Bottom Trust & Brand Strip */
        .ride-options-trust-strip {
          background: rgba(12, 16, 26, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 20px 28px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 20px;
        }
        .trust-strip-item {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .trust-icon-wrap {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: rgba(255, 26, 53, 0.12);
          border: 1px solid rgba(255, 26, 53, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FF1A35;
          flex-shrink: 0;
        }
        .trust-title {
          display: block;
          font-size: 13px;
          font-weight: 700;
          color: #FFFFFF;
        }
        .trust-sub {
          display: block;
          font-size: 11px;
          color: #94A3B8;
        }
        .rupee-char {
          font-size: 18px;
          font-weight: 800;
        }
        .trust-strip-branding {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }
        .slogan-white {
          font-size: 13px;
          font-weight: 600;
          color: #94A3B8;
        }
        .slogan-red {
          font-size: 16px;
          font-weight: 900;
          color: #FF1A35;
          letter-spacing: -0.02em;
        }

        /* ---------------- WHY RIDE WITH OHO SECTION ---------------- */
        .why-ride-section {
          padding: 90px 0 60px;
          background: radial-gradient(80% 50% at 50% 10%, rgba(255, 26, 53, 0.08) 0%, transparent 70%),
                      #07090E;
          position: relative;
        }
        .why-ride-header {
          margin-bottom: 50px;
        }
        .why-badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 26, 53, 0.1);
          border: 1px solid rgba(255, 26, 53, 0.3);
          padding: 5px 14px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: #CBD5E1;
          margin-bottom: 16px;
        }
        .why-red-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #FF1A35;
          box-shadow: 0 0 8px #FF1A35;
        }
        .why-ride-heading {
          font-size: clamp(2.2rem, 1.8rem + 2vw, 3.4rem);
          font-weight: 900;
          color: #FFFFFF;
          margin-bottom: 12px;
          letter-spacing: -0.02em;
        }
        .why-red-highlight {
          color: #FF1A35;
        }
        .why-ride-subtext {
          font-size: 15px;
          color: #94A3B8;
          max-width: 640px;
          margin: 0 auto;
          line-height: 1.6;
        }

        .why-cards-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
          margin-bottom: 50px;
        }
        @media (max-width: 1100px) {
          .why-cards-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 640px) {
          .why-cards-grid {
            grid-template-columns: 1fr;
          }
        }

        .why-card {
          background: rgba(14, 18, 28, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 28px 24px;
          display: flex;
          flex-direction: column;
          position: relative;
          transition: all 0.3s cubic-bezier(0.16, 0.84, 0.28, 1);
        }
        .why-card:hover {
          background: rgba(18, 24, 38, 0.95);
          border-color: rgba(255, 26, 53, 0.45);
          transform: translateY(-6px);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), 0 0 30px rgba(255, 26, 53, 0.12);
        }
        .why-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 22px;
        }
        .why-icon-box {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: rgba(255, 26, 53, 0.12);
          border: 1px solid rgba(255, 26, 53, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FF1A35;
          box-shadow: 0 0 20px rgba(255, 26, 53, 0.2);
        }
        .why-number {
          font-size: 13px;
          font-weight: 800;
          color: #64748B;
          letter-spacing: 0.08em;
          background: rgba(255, 255, 255, 0.05);
          padding: 4px 10px;
          border-radius: 9999px;
        }
        .why-card-title {
          font-size: 18px;
          font-weight: 800;
          color: #FFFFFF;
          margin-bottom: 12px;
          line-height: 1.3;
        }
        .why-card-desc {
          font-size: 13.5px;
          color: #94A3B8;
          line-height: 1.6;
          margin-bottom: 24px;
          flex: 1;
        }
        .why-bottom-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 8px 14px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 600;
          color: #CBD5E1;
        }
        .rupee-icon-small {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgba(255, 26, 53, 0.15);
          color: #FF1A35;
          font-size: 11px;
          font-weight: 800;
        }

        .why-bottom-divider {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 20px;
          margin-top: 20px;
        }
        .divider-line {
          flex: 1;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255, 26, 53, 0.3), transparent);
        }
        .divider-tag {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.15em;
          color: #FF1A35;
          text-shadow: 0 0 10px rgba(255, 26, 53, 0.4);
        }

        /* ---------------- STEPS SECTION ---------------- */
        .steps-section {
          padding: 80px 0;
          background: #07090F;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        .steps-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 28px;
        }
        .step-card {
          background: rgba(18, 23, 34, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 18px;
          padding: 34px 24px;
          position: relative;
          text-align: center;
        }
        .step-number-bubble {
          position: absolute;
          top: 16px;
          right: 20px;
          font-size: 32px;
          font-weight: 900;
          color: rgba(255, 255, 255, 0.07);
          font-family: monospace;
        }
        .step-illustration {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: rgba(217, 4, 41, 0.1);
          border: 1px solid rgba(217, 4, 41, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
        }
        .step-card h3 {
          font-size: 19px;
          font-weight: 700;
          color: #FFFFFF;
          margin-bottom: 8px;
        }
        .step-card p {
          font-size: 13.5px;
          color: #94A3B8;
          line-height: 1.5;
        }

        /* ---------------- DRIVER BANNER ---------------- */
        .driver-banner-section {
          padding: 60px 0 80px;
        }
        .driver-banner-card {
          background: linear-gradient(135deg, rgba(30, 10, 15, 0.95) 0%, rgba(15, 20, 31, 0.95) 100%);
          border: 1px solid rgba(217, 4, 41, 0.35);
          border-radius: 24px;
          padding: 44px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(217, 4, 41, 0.15);
        }
        .driver-banner-grid {
          display: grid;
          grid-template-columns: 1.3fr 0.85fr;
          gap: 40px;
          align-items: center;
        }
        .banner-badge {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          color: #FF2E4D;
          margin-bottom: 12px;
        }
        .banner-title {
          font-size: clamp(1.8rem, 1.4rem + 1.5vw, 2.7rem);
          font-weight: 900;
          color: #FFFFFF;
          line-height: 1.15;
          margin-bottom: 14px;
        }
        .banner-desc {
          font-size: 14.5px;
          color: #CBD5E1;
          line-height: 1.6;
          margin-bottom: 22px;
          max-width: 540px;
        }
        .driver-perks-row {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 26px;
        }
        .perk-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13.5px;
          font-weight: 600;
          color: #F1F5F9;
        }
        .banner-cta-group {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
        }
        .btn-driver-cta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 13px 24px;
          background: #D90429;
          color: #FFFFFF;
          font-size: 14.5px;
          font-weight: 700;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(217, 4, 41, 0.4);
          transition: all 0.2s;
        }
        .btn-driver-cta:hover {
          background: #EF1C38;
          transform: translateY(-2px);
        }
        .btn-driver-wa {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 13px 22px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.16);
          color: #FFFFFF;
          font-size: 14.5px;
          font-weight: 600;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-driver-wa:hover {
          background: rgba(255, 255, 255, 0.15);
        }
        .driver-stats-col {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .driver-stat-card {
          background: rgba(10, 13, 20, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 18px 24px;
        }
        .stat-big-num {
          display: block;
          font-size: 26px;
          font-weight: 900;
          color: #FF2E4D;
        }
        .stat-label {
          font-size: 12.5px;
          color: #94A3B8;
        }

        /* ---------------- APP DOWNLOAD SECTION ---------------- */
        .app-download-section {
          padding: 70px 0;
          background: #07090F;
        }
        .app-download-box {
          background: rgba(18, 23, 34, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          padding: 50px;
        }
        .app-grid {
          display: grid;
          grid-template-columns: 1.15fr 0.85fr;
          gap: 48px;
          align-items: center;
        }
        .app-heading {
          font-size: clamp(1.8rem, 1.4rem + 1.4vw, 2.6rem);
          font-weight: 800;
          color: #FFFFFF;
          line-height: 1.18;
          margin-bottom: 14px;
        }
        .app-subtext {
          font-size: 14.5px;
          color: #94A3B8;
          line-height: 1.6;
          margin-bottom: 26px;
        }
        .app-features-mini {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-bottom: 30px;
        }
        .app-feature-row {
          display: flex;
          gap: 14px;
        }
        .feat-icon-bubble {
          font-size: 18px;
        }
        .app-feature-row strong {
          display: block;
          font-size: 14px;
          color: #FFFFFF;
          margin-bottom: 2px;
        }
        .app-feature-row p {
          font-size: 12.5px;
          color: #94A3B8;
          margin: 0;
        }
        .download-buttons-group {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .store-badge-card {
          background: #0A0D16;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 10px;
          padding: 10px 18px;
          display: flex;
          flex-direction: column;
          cursor: pointer;
          transition: all 0.2s;
        }
        .store-badge-card:hover {
          border-color: #D90429;
          transform: translateY(-2px);
        }
        .badge-small {
          font-size: 9px;
          color: #94A3B8;
          letter-spacing: 0.05em;
        }
        .badge-big {
          font-size: 15px;
          font-weight: 700;
          color: #FFFFFF;
        }

        /* Mockup Phone */
        .app-mockup-col {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 20px;
          position: relative;
        }
        .phone-mockup-frame {
          width: 260px;
          height: 480px;
          background: #0D111C;
          border: 4px solid #2B3548;
          border-radius: 36px;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7), 0 0 20px rgba(217, 4, 41, 0.2);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .mockup-screen-header {
          background: #141A29;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          text-align: center;
          position: relative;
        }
        .screen-notch {
          width: 70px;
          height: 14px;
          background: #000000;
          border-radius: 0 0 10px 10px;
          margin: -12px auto 6px;
        }
        .mockup-brand-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .mockup-logo {
          width: 20px;
          height: 20px;
          border-radius: 4px;
        }
        .mockup-brand-title {
          font-size: 13px;
          font-weight: 800;
          color: #FFFFFF;
        }
        .mockup-screen-body {
          flex: 1;
          padding: 16px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          background: radial-gradient(circle at 50% 40%, rgba(217, 4, 41, 0.08), transparent 70%), #0A0D16;
        }
        .mockup-radar-box {
          position: relative;
          height: 260px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .radar-circle-1 {
          position: absolute;
          width: 140px;
          height: 140px;
          border-radius: 50%;
          border: 1px dashed rgba(217, 4, 41, 0.4);
        }
        .radar-circle-2 {
          position: absolute;
          width: 210px;
          height: 210px;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .radar-car-dot {
          position: absolute;
          top: 60px;
          right: 50px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #22C55E;
          box-shadow: 0 0 8px #22C55E;
        }
        .radar-rider-dot {
          position: absolute;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #D90429;
          box-shadow: 0 0 10px #D90429;
        }
        .radar-label {
          position: absolute;
          bottom: 10px;
          font-size: 10px;
          font-weight: 700;
          color: #22C55E;
          background: rgba(34, 197, 94, 0.1);
          padding: 3px 8px;
          border-radius: 4px;
        }
        .mockup-ride-card {
          background: #141A29;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .mockup-car-thumb {
          width: 34px;
          height: 34px;
          background: rgba(217, 4, 41, 0.12);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .mockup-car-info {
          display: flex;
          flex-direction: column;
        }
        .mockup-car-info strong {
          font-size: 11px;
          color: #FFFFFF;
        }
        .mockup-car-info span {
          font-size: 10px;
          color: #94A3B8;
        }
        .mockup-book-btn {
          background: #D90429;
          color: #FFFFFF;
          border: none;
          padding: 6px 14px;
          font-size: 11px;
          font-weight: 700;
          border-radius: 6px;
        }

        .qr-scan-card {
          background: #FFFFFF;
          border-radius: 16px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          box-shadow: 0 14px 30px rgba(0, 0, 0, 0.4);
          width: 140px;
        }
        .qr-info strong {
          display: block;
          font-size: 12px;
          color: #0F172A;
          margin-top: 6px;
        }
        .qr-info span {
          font-size: 10.5px;
          color: #64748B;
        }

        /* ---------------- STATS SECTION ---------------- */
        .stats-section {
          padding: 60px 0;
          background: #0A0E17;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 24px;
          text-align: center;
        }
        .stat-card {
          padding: 10px;
        }
        .stat-number {
          display: block;
          font-size: clamp(2rem, 1.8rem + 1.2vw, 2.8rem);
          font-weight: 900;
          color: #FFFFFF;
          margin-bottom: 4px;
          background: linear-gradient(180deg, #FFFFFF 30%, #FF4D6D 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .stat-title {
          display: block;
          font-size: 14.5px;
          font-weight: 700;
          color: #E2E8F0;
          margin-bottom: 2px;
        }
        .stat-sub {
          font-size: 12px;
          color: #94A3B8;
        }

        /* ---------------- TESTIMONIALS ---------------- */
        .testimonials-section {
          padding: 80px 0;
          background: #07090F;
        }
        .testimonials-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
        }
        .testi-card {
          background: rgba(18, 23, 34, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          padding: 28px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .testi-stars {
          display: flex;
          gap: 4px;
          margin-bottom: 16px;
        }
        .testi-quote {
          font-size: 14px;
          line-height: 1.6;
          color: #CBD5E1;
          margin-bottom: 24px;
          font-style: italic;
        }
        .testi-author {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .author-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 13px;
          color: #FFFFFF;
        }
        .red-gradient {
          background: linear-gradient(135deg, #EF1C38, #8D0013);
        }
        .testi-author strong {
          display: block;
          font-size: 14px;
          color: #FFFFFF;
        }
        .testi-author span {
          font-size: 12px;
          color: #94A3B8;
        }

        /* ---------------- FAQ ACCORDION ---------------- */
        .faq-section {
          padding: 80px 0;
          background: #0A0E17;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .faq-accordion-list {
          max-width: 800px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .faq-accordion-item {
          background: rgba(18, 23, 34, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          overflow: hidden;
          transition: all 0.2s ease;
        }
        .faq-accordion-item.active {
          border-color: rgba(217, 4, 41, 0.4);
          background: rgba(18, 23, 34, 0.9);
        }
        .faq-question-btn {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 18px 22px;
          background: none;
          border: none;
          color: #FFFFFF;
          font-size: 15.5px;
          font-weight: 600;
          text-align: left;
          cursor: pointer;
        }
        .faq-chevron {
          color: #94A3B8;
          transition: transform 0.3s ease;
        }
        .faq-chevron.rotate {
          transform: rotate(180deg);
          color: #D90429;
        }
        .faq-answer-body {
          padding: 0 22px 20px;
          font-size: 14px;
          color: #94A3B8;
          line-height: 1.6;
        }

        /* ---------------- BOTTOM CTA BANNER ---------------- */
        .bottom-cta-section {
          padding: 70px 0 90px;
          background: #07090F;
        }
        .bottom-cta-banner {
          position: relative;
          background: linear-gradient(135deg, #1C0307 0%, #0D121F 60%, #07090F 100%);
          border: 1px solid rgba(217, 4, 41, 0.4);
          border-radius: 28px;
          padding: 60px 40px;
          text-align: center;
          overflow: hidden;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.6), 0 0 50px rgba(217, 4, 41, 0.2);
        }
        .cta-glow-bg {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 50%, rgba(217, 4, 41, 0.25), transparent 60%);
          pointer-events: none;
        }
        .cta-content {
          position: relative;
          z-index: 2;
          max-width: 650px;
          margin: 0 auto;
        }
        .cta-headline {
          font-size: clamp(2rem, 1.6rem + 1.6vw, 3rem);
          font-weight: 900;
          color: #FFFFFF;
          margin-bottom: 14px;
          line-height: 1.15;
        }
        .cta-sub {
          font-size: 15.5px;
          color: #CBD5E1;
          margin-bottom: 30px;
          line-height: 1.55;
        }
        .cta-buttons {
          display: flex;
          justify-content: center;
          gap: 16px;
          flex-wrap: wrap;
        }
        .btn-cta-primary {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 15px 30px;
          font-size: 15.5px;
          font-weight: 700;
          color: #FFFFFF;
          background: linear-gradient(135deg, #EF1C38 0%, #D90429 50%, #B8001F 100%);
          border: none;
          border-radius: 12px;
          cursor: pointer;
          box-shadow: 0 8px 24px rgba(217, 4, 41, 0.45);
          transition: all 0.2s ease;
        }
        .btn-cta-primary:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 30px rgba(217, 4, 41, 0.6);
        }
        .btn-cta-outline {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 15px 28px;
          font-size: 15.5px;
          font-weight: 600;
          color: #FFFFFF;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .btn-cta-outline:hover {
          background: rgba(255, 255, 255, 0.16);
        }

        /* ---------------- RESPONSIVE BREAKPOINTS ---------------- */
        @media (max-width: 1024px) {
          .hero-grid {
            grid-template-columns: 1fr;
            gap: 40px;
          }
          .hero-visual-column {
            order: -1;
          }
          .visual-stage-wrapper {
            min-height: 380px;
          }
          .categories-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .advantage-cards-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .driver-banner-grid {
            grid-template-columns: 1fr;
          }
          .app-grid {
            grid-template-columns: 1fr;
          }
          .stats-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .testimonials-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 640px) {
          .hero-section {
            padding: 30px 0 50px;
          }
          .quick-vehicle-pills {
            grid-template-columns: repeat(2, 1fr);
          }
          .widget-bottom-meta {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }
          .categories-grid {
            grid-template-columns: 1fr;
          }
          .advantage-cards-grid {
            grid-template-columns: 1fr;
          }
          .steps-grid {
            grid-template-columns: 1fr;
          }
          .driver-banner-card {
            padding: 24px;
          }
          .app-download-box {
            padding: 24px;
          }
          .float-card-top-right {
            right: 0;
            top: 0;
          }
          .float-card-bottom-left {
            left: 0;
            bottom: 0;
          }
          .app-mockup-col {
            flex-direction: column;
          }
          .stats-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default Home;
