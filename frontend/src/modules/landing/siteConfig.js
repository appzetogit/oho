// Single source of truth for OHO RIDE contact + presence details.
// Change a number/email/address HERE only — every page reads from this file.

export const CONTACT = {
  email: 'support@ohoride.in',
  whatsapp: '919876500000',
  whatsappDisplay: '+91 98765 00000',
  tollFree: '1800 200 9999',
  tollFreeLive: false,
  address: 'Grand Majestic Mall, Gandhinagar, Bengaluru, Karnataka 560009',
  addressShort: 'Grand Majestic Mall, Gandhinagar, Bengaluru',
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=Grand+Majestic+Mall+Gandhinagar+Bengaluru',
};

export const waLink = (msg = "Hi OHO RIDE, I'd like to book a ride.") =>
  `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(msg)}`;

export const LAUNCH_CITIES = [
  { name: 'Bengaluru', note: 'Head Office & Launch City' },
  { name: 'Mangaluru', note: 'Coastal Karnataka Operations' },
  { name: 'Hubballi', note: 'North Karnataka Operations' },
];
