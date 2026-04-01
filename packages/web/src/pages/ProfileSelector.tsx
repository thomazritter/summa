import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { profileApi } from '../api/client';

interface Profile { id: number; name: string; expertise: string; focus: string; depth: string; }

export function ProfileSelector({ userId }: { userId: number }) {
  const navigate = useNavigate();
  const { data: profiles, isLoading } = useQuery({ queryKey: ['profiles', userId], queryFn: () => profileApi.getByUser(userId) });

  const handleSelect = (profile: Profile) => {
    sessionStorage.setItem('selectedProfileId', String(profile.id));
    navigate('/upload');
  };

  if (isLoading) return <div className="text-center py-8">Loading profiles...</div>;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Select Your Profile</h2>
      <p className="text-gray-600">Choose a profile to personalize your summaries.</p>
      {(profiles as Profile[])?.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border">
          <p className="text-gray-500 mb-4">No profiles yet. Please create one via the API.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {(profiles as Profile[])?.map((profile) => (
            <div key={profile.id} className="bg-white p-4 rounded-lg border hover:border-blue-500 cursor-pointer" onClick={() => handleSelect(profile)}>
              <h3 className="font-semibold text-lg">{profile.name}</h3>
              <div className="text-sm text-gray-500 mt-1 space-x-3">
                <span>Level: {profile.expertise}</span>
                <span>Focus: {profile.focus}</span>
                <span>Depth: {profile.depth}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
