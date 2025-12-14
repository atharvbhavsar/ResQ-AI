import React from "react";

const MidHeader = () => {
  return (
    <div className="w-full justify-between flex" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div className=" md:flex px-2 py-4">
        <h2 className="text-xl mr-10 w-96 font-bold" style={{ 
          fontSize: '1.25rem', 
          fontWeight: '700',
          color: '#F3F4F6',
          letterSpacing: '-0.025em'
        }}>
          Incoming Emergencies
        </h2>
        <div className="h-7 text-sm items-center flex w-full justify-between font-bold">
          <h3 style={{ 
            fontWeight: '700',
            fontSize: '0.875rem',
            color: '#EF4444'
          }}>
            Emergencies
          </h3>
          <h3 style={{ fontWeight: '500', fontSize: '0.875rem', color: '#D1D5DB' }}>Scheduling</h3>
          <h3 style={{ fontWeight: '500', fontSize: '0.875rem', color: '#D1D5DB' }}>Progress</h3>
          <h3 style={{ fontWeight: '500', fontSize: '0.875rem', color: '#D1D5DB' }}>Forms</h3>
          <h3 style={{ fontWeight: '500', fontSize: '0.875rem', color: '#D1D5DB' }}>More</h3>
        </div>
      </div>
    </div>
  );
};

export default MidHeader;
