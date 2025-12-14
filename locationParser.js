// Location parsing utility - Extract city, district, state from addresses
const axios = require('axios');

// Indian location mapping for common place names
const INDIAN_LOCATION_MAP = {
  'pune': { city: 'Pune', district: 'Pune', state: 'Maharashtra', country: 'India' },
  'vit': { city: 'Pune City', district: 'Pune', state: 'Maharashtra', country: 'India' },
  'vishwakarma': { city: 'Pune City', district: 'Pune', state: 'Maharashtra', country: 'India' },
  'mumbai': { city: 'Mumbai', district: 'Mumbai City', state: 'Maharashtra', country: 'India' },
  'delhi': { city: 'New Delhi', district: 'Central Delhi', state: 'Delhi', country: 'India' },
  'bangalore': { city: 'Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', country: 'India' },
  'bengaluru': { city: 'Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', country: 'India' },
  'chennai': { city: 'Chennai', district: 'Chennai', state: 'Tamil Nadu', country: 'India' },
  'hyderabad': { city: 'Hyderabad', district: 'Hyderabad', state: 'Telangana', country: 'India' },
  'kolkata': { city: 'Kolkata', district: 'Kolkata', state: 'West Bengal', country: 'India' },
  'ahmedabad': { city: 'Ahmedabad', district: 'Ahmedabad', state: 'Gujarat', country: 'India' },
  'lucknow': { city: 'Lucknow', district: 'Lucknow', state: 'Uttar Pradesh', country: 'India' },
  'jaipur': { city: 'Jaipur', district: 'Jaipur', state: 'Rajasthan', country: 'India' },
  'chandigarh': { city: 'Chandigarh', district: 'Chandigarh', state: 'Chandigarh', country: 'India' },
  'amritsar': { city: 'Amritsar', district: 'Amritsar', state: 'Punjab', country: 'India' },
  'ludhiana': { city: 'Ludhiana', district: 'Ludhiana', state: 'Punjab', country: 'India' },
  'nagpur': { city: 'Nagpur City', district: 'Nagpur Urban Taluka', state: 'Maharashtra', country: 'India' },
  'aurangabad': { city: 'Aurangabad', district: 'Aurangabad', state: 'Maharashtra', country: 'India' }
};

/**
 * Parse full address into city, district, state, country
 * Uses Nominatim reverse geocoding and Indian location mapping
 */
async function parseLocationComponents(address, lat, lon) {
  try {
    // Skip if no valid address or coordinates
    if (!address || address === "undefined" || address === "Location not provided by caller") {
      address = null;
    }

    // If we have coordinates, reverse geocode
    if (lat && lon) {
      try {
        const response = await axios.get(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
          {
            headers: { 'User-Agent': 'TriageAI-911-Dispatch-System' },
            timeout: 5000
          }
        );

        const data = response.data.address || {};
        
        return {
          city: data.city || data.town || data.village || 'Unknown',
          district: data.county || data.district || data.state_district || 'Unknown',
          state: data.state || 'Unknown',
          country: data.country || 'India',
          displayName: response.data.display_name || address || 'Retrieved from coordinates',
          formatted: true
        };
      } catch (geoError) {
        console.log('⚠️ [Location] Reverse geocoding failed:', geoError.message);
        // Fall through to address parsing
      }
    }

    // Try to match against known Indian locations
    if (address && address !== "undefined" && address.length > 0) {
      const addressLower = address.toLowerCase();
      for (const [key, location] of Object.entries(INDIAN_LOCATION_MAP)) {
        if (addressLower.includes(key)) {
          console.log(`✅ [Location] Matched "${address}" to ${location.city}, ${location.state}`);
          return {
            city: location.city,
            district: location.district,
            state: location.state,
            country: location.country,
            displayName: address,
            formatted: true
          };
        }
      }
    }

    // Fallback: Parse address string manually if available
    if (address && address !== "undefined" && address.length > 3) {
      const parts = address.split(',').map(p => p.trim()).filter(p => p.length > 0);
      
      if (parts.length >= 2) {
        return {
          city: parts[0] || 'Unknown',
          district: parts.length >= 3 ? parts[parts.length - 2] : 'Unknown',
          state: parts[parts.length - 1] || 'Unknown',
          country: 'India',
          displayName: address,
          formatted: false
        };
      }
    }

    // Safe fallback when all else fails
    return {
      city: 'Unknown',
      district: 'Unknown',
      state: 'Unknown',
      country: 'India',
      displayName: address || 'Unknown Location',
      formatted: false
    };
  } catch (error) {
    console.log('⚠️ [Location Parse] Error:', error.message);
    
    // Safe fallback on error
    return {
      city: 'Unknown',
      district: 'Unknown',
      state: 'Unknown',
      country: 'India',
      displayName: address || 'Unknown Location',
      formatted: false
    };
  }
}

/**
 * Get all unique locations from database
 */
async function getUniqueLocations(db) {
  try {
    const locations = db.prepare(`
      SELECT DISTINCT city, district, state 
      FROM emergency_calls 
      WHERE city != 'Unknown' 
      ORDER BY state, district, city
    `).all();
    
    return locations;
  } catch (error) {
    console.log('⚠️ [Get Locations] Error:', error.message);
    return [];
  }
}

/**
 * Get location hierarchy for dropdown
 */
async function getLocationHierarchy(db) {
  try {
    const states = db.prepare(`
      SELECT DISTINCT state FROM emergency_calls 
      WHERE state != 'Unknown' ORDER BY state
    `).all();

    const hierarchy = {};
    
    for (const stateObj of states) {
      const state = stateObj.state;
      const districts = db.prepare(`
        SELECT DISTINCT district FROM emergency_calls 
        WHERE state = ? AND district != 'Unknown' 
        ORDER BY district
      `).all(state);

      hierarchy[state] = {};
      
      for (const districtObj of districts) {
        const district = districtObj.district;
        const cities = db.prepare(`
          SELECT DISTINCT city FROM emergency_calls 
          WHERE state = ? AND district = ? AND city != 'Unknown' 
          ORDER BY city
        `).all(state, district);

        hierarchy[state][district] = cities.map(c => c.city);
      }
    }
    
    return hierarchy;
  } catch (error) {
    console.log('⚠️ [Location Hierarchy] Error:', error.message);
    return {};
  }
}

module.exports = {
  parseLocationComponents,
  getUniqueLocations,
  getLocationHierarchy
};
