import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, Ban, Check, ChevronDown, CircleHelp, Compass, Hash, ImagePlus,
  LogOut, Menu, MessageCircle, MoreHorizontal, Plus, Radio, Search, Send, Shield,
  ShieldAlert, Smile, Sparkles, UserRound, Users, X,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { hasSupabaseConfig, supabase } from './libs/Supabase';

type Profile = { id: string; username: string; created_at?: string };
type Room = { id: string; name: string; description: string; created_at?: string };
type ChatMessage = {
  id: string; sender_id: string; body: string | null; image_path: string | null;
  created_at: string; room_id: string | null; conversation_id: string | null;
  sender?: { username: string } | null; imageUrl?: string | null;
};
type Conversation = { id: string; otherUser: Profile; updated_at?: string };
type OnlinePerson = { user_id: string; username: string };
type Report = { id: string; reason: string; created_at: string; status: string; reported_body: string | null; reported_image_path: string | null; reported_sender_id: string | null; profiles?: { username: string } | null };

function initials(name: string) {
  return (name.trim().replace(/^@/, '').slice(0, 2) || 'NX').toUpperCase();
}
function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
function dayLabel(value: string) {
  const d = new Date(value);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booting, setBooting] = useState(true);
  const [setupName, setSetupName] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState<OnlinePerson[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [peopleResults, setPeopleResults] = useState<Profile[]>([]);
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeRoom = useMemo(() => rooms.find((r) => r.id === roomId) ?? null, [rooms, roomId]);
  const currentTitle = activeConversation ? `@${activeConversation.otherUser.username}` : `#${activeRoom?.name ?? 'general'}`;

  const flash = useCallback((message: string, isError = false) => {
    if (isError) setError(message); else setNotice(message);
    window.setTimeout(() => { setNotice(''); setError(''); }, 4200);
  }, []);

  const boot = useCallback(async () => {
    if (!hasSupabaseConfig) { setBooting(false); return; }
    try {
      const { data: { session: existing } } = await supabase.auth.getSession();
      let current = existing;
      if (!current) {
        const { data, error: authError } = await supabase.auth.signInAnonymously();
        if (authError) throw authError;
        current = data.session;
      }
      setSession(current);
      if (current?.user) {
        const { data: existingProfile, error: profileError } = await supabase.from('profiles').select('id, username, created_at').eq('id', current.user.id).maybeSingle();
        if (profileError) throw profileError;
        if (existingProfile) setProfile(existingProfile as Profile);
      }
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : 'Could not connect to Supabase. Check your setup.');
    } finally { setBooting(false); }
  }, []);

  useEffect(() => {
    void boot();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => subscription.unsubscribe();
  }, [boot]);

  const loadRooms = useCallback(async () => {
    const { data, error: queryError } = await supabase.from('rooms').select('id, name, description, created_at').order('name');
    if (queryError) { flash(queryError.message, true); return; }
    const loaded = (data ?? []) as Room[];
    setRooms(loaded);
    if (!roomId && loaded.length) setRoomId(loaded.find((r) => r.name === 'general')?.id ?? loaded[0].id);
  }, [flash, roomId]);

  const loadConversations = useCallback(async () => {
    if (!session?.user.id || !profile) return;
    const { data, error: queryError } = await supabase.rpc('list_direct_conversations');
    if (queryError) return;
    const parsed: Conversation[] = (data ?? []).map((row: any) => ({
      id: row.conversation_id,
      updated_at: row.updated_at,
      otherUser: { id: row.other_user_id, username: row.other_username },
    }));
    setConversations(parsed);
  }, [session?.user.id, profile]);

  useEffect(() => { if (profile) { void loadRooms(); void loadConversations(); } }, [profile, loadRooms, loadConversations]);

  useEffect(() => {
    if (!session?.user.id || !profile) return;
    const channel = supabase.channel('nexus-online', { config: { presence: { key: session.user.id } } });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<{ user_id?: string; username?: string }>();
      const people: OnlinePerson[] = Object.values(state).flat().map((entry) => ({ user_id: entry.user_id ?? '', username: entry.username ?? 'Guest' })).filter((p) => p.user_id);
      setOnline(Array.from(new Map(people.map((p) => [p.user_id, p])).values()));
    });
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await channel.track({ user_id: session.user.id, username: profile.username, online_at: new Date().toISOString() });
    });
    return () => { void supabase.removeChannel(channel); };
  }, [session?.user.id, profile]);

  const loadMessages = useCallback(async () => {
    if (!profile || (!roomId && !activeConversation)) return;
    let query = supabase.from('messages').select('id, sender_id, body, image_path, created_at, room_id, conversation_id, profiles!messages_sender_id_fkey(username)');
    query = activeConversation ? query.eq('conversation_id', activeConversation.id) : query.eq('room_id', roomId);
    const { data, error: queryError } = await query.order('created_at', { ascending: true }).limit(100);
    if (queryError) { flash(queryError.message, true); return; }
    const rows = (data ?? []).map((row: any) => ({ ...row, sender: row.profiles, imageUrl: null })) as ChatMessage[];
    const hydrated = await Promise.all(rows.map(async (message) => {
      if (!message.image_path) return message;
      const { data: signed } = await supabase.storage.from('chat-images').createSignedUrl(message.image_path, 60 * 60);
      return { ...message, imageUrl: signed?.signedUrl ?? null };
    }));
    setMessages(hydrated);
    window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 40);
  }, [profile, roomId, activeConversation, flash]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase.channel('nexus-message-updates');
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => { void loadMessages(); });
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants' }, () => { void loadConversations(); });
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile, loadMessages, loadConversations]);

  useEffect(() => {
    if (!session?.user.id || !profile) return;
    void supabase.from('moderator_roles').select('user_id').eq('user_id', session.user.id).maybeSingle().then(({ data }) => setIsModerator(Boolean(data)));
    void supabase.from('user_bans').select('reason, expires_at').eq('user_id', session.user.id).maybeSingle().then(({ data }) => {
      if (data && (!data.expires_at || new Date(data.expires_at) > new Date())) flash(`Your account is restricted: ${data.reason || 'moderator action'}`, true);
    });
  }, [session?.user.id, profile, flash]);

  const createProfile = async (event: FormEvent) => {
    event.preventDefault(); setSetupError('');
    const username = setupName.trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9_]{3,18}$/.test(username)) { setSetupError('Use 3–18 letters, numbers or underscores.'); return; }
    if (!session?.user.id) { setSetupError('Your guest session is missing. Refresh and try again.'); return; }
    setSetupBusy(true);
    const { data, error: insertError } = await supabase.from('profiles').insert({ id: session.user.id, username }).select('id, username, created_at').single();
    if (insertError) setSetupError(insertError.code === '23505' ? 'That username is taken. Try another one.' : insertError.message);
    else setProfile(data as Profile);
    setSetupBusy(false);
  };

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!profile || !session?.user.id || !draft.trim() || sending) return;
    const body = draft.trim();
    if (body.length > 2000) { flash('Messages must be 2,000 characters or fewer.', true); return; }
    setSending(true);
    
if (activeConversation) {
  const { error: insertError } = await supabase.from('messages').insert({
    sender_id: session.user.id,
    conversation_id: activeConversation.id,
    body
  });
  if (insertError) flash(insertError.message, true);
} else {
  const { error: insertError } = await supabase.from('messages').insert({
    sender_id: session.user.id,
    room_id: roomId,
    body
  });
  if (insertError) flash(insertError.message, true);
}

     Seadrift('');
    setSending(false);
  };

  const sendImage = async (file: File) => {
  if (!session?.user || !file) return;

  setSending(true);

  try {
    const path = `${session.user.id}/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from('chat-images')
      .upload(path, file);

    if (uploadError) {
      flash(uploadError.message, true);
      return;
    }

    if (activeConversation) {
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          sender_id: session.user.id,
          conversation_id: activeConversation.id,
          image_path: path,
        });

      if (messageError) flash(messageError.message, true);
      else flash('Image sent.');
    } else {
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          sender_id: session.user.id,
          room_id: roomId,
          image_path: path,
        });

      if (messageError) flash(messageError.message, true);
      else flash('Image sent.');
    }
  } catch (error) {
    flash(error instanceof Error ? error.message : 'Image upload failed.', true);
  } finally {
    setSending(false);
    if (fileRef.current) fileRef.current.value = '';
  }
};
  const searchPeople = async (event: FormEvent) => {
    event.preventDefault();
    const query = peopleSearch.trim().replace(/^@/, '');
    if (query.length < 3) { flash('Enter at least 3 characters to search.', true); return; }
    setSearchingPeople(true);
    const { data, error: queryError } = await supabase.from('profiles').select('id, username').ilike('username', `%${query}%`).neq('id', session?.user.id ?? '').limit(10);
    if (queryError) flash(queryError.message, true); else setPeopleResults((data ?? []) as Profile[]);
    setSearchingPeople(false);
  };

  const openDM = async (person: Profile) => {
    const { data, error: rpcError } = await supabase.rpc('create_direct_conversation', { target_user_id: person.id });
    if (rpcError) { flash(rpcError.message, true); return; }
    const convo: Conversation = { id: data as string, otherUser: person };
    setActiveConversation(convo); setShowPeople(false); setPeopleResults([]); setPeopleSearch(''); setShowMobileSidebar(false);
    await loadConversations();
  };

  const reportMessage = async (message: ChatMessage) => {
    const reason = window.prompt('Why are you reporting this message? (spam, harassment, inappropriate content, other)');
    if (!reason?.trim()) return;
    const { error: reportError } = await supabase.from('reports').insert({ reporter_id: session?.user.id, message_id: message.id, reason: reason.trim().slice(0, 300) });
    if (reportError) flash(reportError.message, true); else flash('Report sent to moderators.');
  };

  const loadReports = async () => {
    if (!isModerator) return;
    const { data, error: reportError } = await supabase.from('reports').select('id, reason, created_at, status, reported_body, reported_image_path, reported_sender_id, profiles!reports_reported_sender_id_fkey(username)').eq('status', 'open').order('created_at', { ascending: false }).limit(50);
    if (reportError) flash(reportError.message, true);
    else setReports((data ?? []) as unknown as Report[]);
  };

  const updateReport = async (reportId: string, status: 'reviewed' | 'dismissed') => {
    const { error: updateError } = await supabase.from('reports').update({ status }).eq('id', reportId);
    if (updateError) flash(updateError.message, true);
    else { setReports((items) => items.filter((item) => item.id !== reportId)); flash(status === 'reviewed' ? 'Report marked reviewed.' : 'Report dismissed.'); }
  };

  const banUser = async (message: ChatMessage) => {
    if (!isModerator || message.sender_id === session?.user.id) return;
    const reason = window.prompt(`Reason for restricting @${message.sender?.username ?? 'this user'}?`, 'Community rules');
    if (reason === null) return;
    const { error: modError } = await supabase.rpc('moderate_user', { target_user_id: message.sender_id, ban_reason: reason.trim().slice(0, 300), duration_minutes: 60 * 24 });
    if (modError) flash(modError.message, true); else flash(`@${message.sender?.username ?? 'User'} restricted for 24 hours.`);
  };

  const createRoom = async () => {
    if (!isModerator) { flash('Only moderators can create rooms.', true); return; }
    const name = window.prompt('Room name (letters, numbers, hyphens; 2–24 characters)');
    if (!name) return;
    const safeName = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9-]{2,24}$/.test(safeName)) { flash('Use 2–24 letters, numbers or hyphens.', true); return; }
    const description = window.prompt('Short room description', 'A place to chat') ?? 'A place to chat';
    const { data, error: insertError } = await supabase.from('rooms').insert({ name: safeName, description: description.slice(0, 120), created_by: session?.user.id }).select('id').single();
    if (insertError) flash(insertError.message, true); else { await loadRooms(); if (data) setRoomId(data.id); flash('Room created.'); }
  };

  const signOutGuest = async () => {
    const ok = window.confirm('Leave this guest session? Without a linked account, you may not be able to get this username or private messages back.');
    if (!ok) return;
    await supabase.auth.signOut(); setProfile(null); setSession(null); setMessages([]); setConversations([]); setActiveConversation(null); setRoomId(''); setSetupName(''); setBooting(true); void boot();
  };

  const changeRoom = (id: string) => { setRoomId(id); setActiveConversation(null); setShowMobileSidebar(false); };
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    setShowScrollButton(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
  };

  if (!hasSupabaseConfig) return <SetupScreen />;
  if (booting) return <div className="loading-screen"><div className="brand-mark"><Sparkles size={22} /></div><div className="loader"/><p>Connecting to Nexus…</p></div>;
  if (!session) return <div className="loading-screen"><div className="brand-mark"><Sparkles size={22} /></div><h2>Couldn't start a guest session</h2><p className="muted">{setupError || 'Check your Supabase anonymous sign-in settings and reload.'}</p><button className="primary-button" onClick={() => { setBooting(true); void boot(); }}>Try again</button></div>;
  if (!profile) return <div className="onboarding-wrap"><div className="onboarding-card glass"><div className="brand-lockup"><div className="brand-mark"><Sparkles size={22}/></div><span>NEXUS<span className="brand-light"> CHAT</span></span></div><div className="eyebrow">YOUR SPACE, YOUR PEOPLE</div><h1>Join the conversation.</h1><p className="muted">Pick a guest username to enter. No email or password required.</p><form onSubmit={createProfile} className="setup-form"><label htmlFor="username">Guest username</label><div className="username-input"><span>@</span><input id="username" value={setupName} onChange={(e) => setSetupName(e.target.value)} placeholder="yourname" maxLength={18} autoComplete="nickname" autoFocus /></div><div className="field-hint">3–18 letters, numbers or underscores. Usernames are public.</div>{setupError && <div className="inline-error">{setupError}</div>}<button className="primary-button full" disabled={setupBusy}>{setupBusy ? 'Joining…' : 'Enter Nexus'} <ArrowDown size={16}/></button></form><p className="fine-print"><Shield size={13}/> Keep personal information private. Guest sessions may not be recoverable.</p></div></div>;

  return <div className="app-shell">
    <aside className={`sidebar ${showMobileSidebar ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top"><div className="brand-lockup"><div className="brand-mark"><Sparkles size={20}/></div><span>NEXUS<span className="brand-light"> CHAT</span></span></div><button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setShowMobileSidebar(false)}><X size={19}/></button></div>
      <button className="workspace-switch"><div className="workspace-avatar">N</div><div className="workspace-copy"><strong>Nexus Community</strong><span>Public space</span></div><ChevronDown size={15}/></button>
      <nav className="side-nav">
        <div className="nav-section-head"><span>YOUR SPACE</span><button className="tiny-icon" aria-label="Create room" onClick={createRoom}><Plus size={15}/></button></div>
        <button className={`nav-item ${!activeConversation ? 'active' : ''}`} onClick={() => { setActiveConversation(null); if (!roomId && rooms.length) setRoomId(rooms[0].id); }}><Compass size={17}/><span>Explore rooms</span><span className="nav-count">{rooms.length}</span></button>
        <div className="room-list">{rooms.map((room) => <button key={room.id} className={`nav-item room-item ${!activeConversation && roomId === room.id ? 'selected' : ''}`} onClick={() => changeRoom(room.id)}><Hash size={16}/><span>{room.name}</span></button>)}</div>
        <div className="nav-section-head direct-head"><span>DIRECT MESSAGES</span><button className="tiny-icon" aria-label="Find people" onClick={() => setShowPeople(true)}><Plus size={15}/></button></div>
        {conversations.length ? <div className="dm-list">{conversations.map((conversation) => <button key={conversation.id} className={`nav-item dm-item ${activeConversation?.id === conversation.id ? 'selected' : ''}`} onClick={() => { setActiveConversation(conversation); setShowMobileSidebar(false); }}><span className="mini-avatar">{initials(conversation.otherUser.username)}</span><span>@{conversation.otherUser.username}</span></button>)}</div> : <button className="empty-dm" onClick={() => setShowPeople(true)}><MessageCircle size={15}/><span>Start a conversation</span></button>}
      </nav>
      <div className="sidebar-bottom"><div className="community-card"><div className="community-icon"><Radio size={16}/></div><div><strong>Live community</strong><span>{online.length} online right now</span></div><span className="online-pulse"/></div><div className="profile-row"><div className="avatar avatar-you">{initials(profile.username)}</div><div className="profile-copy"><strong>@{profile.username}</strong><span><i className="status-dot"/> Guest member{isModerator ? ' · Moderator' : ''}</span></div><button className="icon-button" aria-label="Leave guest session" title="Leave guest session" onClick={signOutGuest}><LogOut size={16}/></button></div></div>
    </aside>
    {showMobileSidebar && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setShowMobileSidebar(false)}/>}
    <main className="main-panel">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setShowMobileSidebar(true)}><Menu size={20}/></button><div className="channel-symbol">{activeConversation ? <MessageCircle size={18}/> : <Hash size={19}/>}</div><div className="channel-title"><h2>{currentTitle}</h2><span>{activeConversation ? 'Private conversation' : activeRoom?.description || 'Community conversation'}</span></div></div><div className="topbar-actions"><div className="online-chip"><span className="status-dot"/>{online.length} online</div><button className="icon-button" aria-label="Find people" title="Find people" onClick={() => setShowPeople(true)}><Search size={18}/></button><button className="icon-button help-button" aria-label="Community guidelines" title="Community guidelines" onClick={() => flash('Be kind. Don’t share private information. Report harmful content. Images are limited to 5 MB.') }><CircleHelp size={18}/></button></div></header>
      <div className="chat-content" ref={scrollRef} onScroll={handleScroll}>
        <div className="chat-intro"><div className="intro-icon">{activeConversation ? <MessageCircle size={22}/> : <Hash size={23}/>}</div><h1>{activeConversation ? `You're chatting with @${activeConversation.otherUser.username}` : `Welcome to #${activeRoom?.name ?? 'general'}`}</h1><p>{activeConversation ? 'This is a private conversation between you and this guest.' : activeRoom?.description || 'A place to meet the community.'} <span className="intro-separator">·</span> Messages are live.</p><div className="intro-rule"><span>YOUR CONVERSATION STARTS HERE</span></div></div>
        {messages.length === 0 ? <div className="empty-chat"><div className="empty-chat-orb"><MessageCircle size={25}/></div><strong>No messages yet</strong><span>Be the first to say something. Keep it friendly.</span></div> : <div className="message-list">{messages.map((message, index) => {
          const previous = messages[index - 1];
          const grouped = previous && previous.sender_id === message.sender_id && new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < 5 * 60 * 1000 && dayLabel(previous.created_at) === dayLabel(message.created_at);
          const showDay = !previous || dayLabel(previous.created_at) !== dayLabel(message.created_at);
          const own = message.sender_id === session.user.id;
          return <div key={message.id}>{showDay && <div className="day-divider"><span>{dayLabel(message.created_at)}</span></div>}<article className={`message ${grouped ? 'message-grouped' : ''}`}><div className="message-avatar-wrap">{!grouped && <div className={`avatar message-avatar ${own ? 'avatar-you' : ''}`}>{initials(message.sender?.username ?? 'Guest')}</div>}</div><div className="message-body"><div className="message-meta">{!grouped && <><strong>{message.sender?.username ?? 'Guest'}</strong>{own && <span className="you-tag">YOU</span>}</>}<time>{timeLabel(message.created_at)}</time><div className="message-actions"><button title="Report message" aria-label="Report message" onClick={() => void reportMessage(message)}><ShieldAlert size={14}/></button>{isModerator && !own && <button title="Restrict user for 24 hours" aria-label="Restrict user" onClick={() => void banUser(message)}><Ban size={14}/></button>}</div></div>{message.body && <p className="message-text">{message.body}</p>}{message.image_path && (message.imageUrl ? <a href={message.imageUrl} target="_blank" rel="noreferrer" className="message-image-link"><img src={message.imageUrl} alt={`Image shared by ${message.sender?.username ?? 'guest'}`} className="message-image" loading="lazy"/></a> : <span className="muted">Image unavailable</span>)}</div></article></div>;
        })}</div>}
        <div ref={bottomRef}/>
      </div>
      {showScrollButton && <button className="scroll-bottom" onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}><ArrowDown size={16}/> Latest messages</button>}
      <div className="composer-area"><form className="composer glass" onSubmit={sendMessage}><button type="button" className="composer-icon" title="Attach image" aria-label="Attach image" disabled={sending} onClick={() => fileRef.current?.click()}><ImagePlus size={19}/></button><input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void sendImage(e.target.files?.[0])}/><input className="message-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Message ${currentTitle}`} maxLength={2000} aria-label="Message"/><button type="button" className="composer-icon emoji-button" title="Add a smile" aria-label="Add a smile" onClick={() => setDraft((v) => `${v}${v ? ' ' : ''}🙂`)}><Smile size={19}/></button><button className="send-button" type="submit" disabled={!draft.trim() || sending} aria-label="Send message">{sending ? <div className="mini-loader"/> : <Send size={17}/>}</button></form><div className="composer-foot"><span><Shield size={12}/> Be respectful. Never share passwords or private details.</span><span>{draft.length}/2000</span></div></div>
    </main>
    <aside className="right-rail"><div className="rail-heading"><span>COMMUNITY</span><button className="tiny-icon" aria-label="Refresh online list" onClick={() => flash('Online status updates automatically.')}><MoreHorizontal size={17}/></button></div><div className="rail-card community-summary"><div className="summary-top"><div className="summary-icon"><Users size={19}/></div><span className="live-label"><i className="status-dot"/> LIVE</span></div><strong>{online.length} people online</strong><p>People here right now, across Nexus.</p><div className="avatar-stack">{online.slice(0, 5).map((person) => <div key={person.user_id} className="avatar stack-avatar" title={person.username}>{initials(person.username)}</div>)}{online.length > 5 && <div className="avatar stack-more">+{online.length - 5}</div>}</div></div><div className="rail-section"><div className="rail-section-title"><span>ONLINE NOW</span><span className="count-pill">{online.length}</span></div>{online.length ? <div className="online-list">{online.map((person) => <div className="online-person" key={person.user_id}><div className="avatar online-avatar">{initials(person.username)}</div><div className="online-person-copy"><strong>{person.username}{person.user_id === session.user.id ? ' (you)' : ''}</strong><span><i className="status-dot"/> Active now</span></div><button className="tiny-icon online-dm" title={`Message ${person.username}`} aria-label={`Message ${person.username}`} disabled={person.user_id === session.user.id} onClick={() => { void supabase.from('profiles').select('id, username').eq('id', person.user_id).single().then(({ data }) => { if (data) void openDM(data as Profile); }); }}><MessageCircle size={14}/></button></div>)}</div> : <p className="rail-empty">You're the first one here. Invite someone in.</p>}</div><div className="rail-section discover-section"><div className="rail-section-title"><span>QUICK LINKS</span></div><button className="quick-link" onClick={() => setShowPeople(true)}><div className="quick-link-icon"><Search size={16}/></div><div><strong>Find people</strong><span>Start a private chat</span></div><ArrowLeft size={15} className="quick-arrow"/></button><button className="quick-link" onClick={() => flash('Rules: be respectful, no spam, no harassment, no illegal content, and do not share personal information.')}><div className="quick-link-icon"><Shield size={16}/></div><div><strong>Community rules</strong><span>Keep Nexus welcoming</span></div><ArrowLeft size={15} className="quick-arrow"/></button>{isModerator && <button className="quick-link" onClick={() => { setShowReports(true); void loadReports(); }}><div className="quick-link-icon"><ShieldAlert size={16}/></div><div><strong>Review reports</strong><span>Moderation queue</span></div><ArrowLeft size={15} className="quick-arrow"/></button>}{isModerator && <button className="quick-link" onClick={createRoom}><div className="quick-link-icon"><Plus size={16}/></div><div><strong>Create a room</strong><span>Moderator controls</span></div><ArrowLeft size={15} className="quick-arrow"/></button>}</div><div className="rail-footer"><div className="footer-brand"><div className="brand-mark small"><Sparkles size={13}/></div><span>NEXUS CHAT</span><span className="version-tag">BETA</span></div><p>A little corner of the internet.</p><span>Guest mode · Community-powered</span></div></aside>
    {(notice || error) && <div className={`toast ${error ? 'toast-error' : ''}`} role="status"><span className="toast-icon">{error ? <X size={16}/> : <Check size={16}/>}</span>{error || notice}<button onClick={() => { setNotice(''); setError(''); }} aria-label="Dismiss"><X size={14}/></button></div>}
    {showPeople && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowPeople(false); }}><section className="people-modal glass" role="dialog" aria-modal="true" aria-labelledby="people-title"><div className="modal-heading"><div><div className="eyebrow">MAKE A CONNECTION</div><h2 id="people-title">Find people</h2><p>Search guest usernames to start a private conversation.</p></div><button className="icon-button" aria-label="Close" onClick={() => setShowPeople(false)}><X size={18}/></button></div><form className="people-search" onSubmit={searchPeople}><Search size={17}/><input value={peopleSearch} onChange={(e) => setPeopleSearch(e.target.value)} placeholder="Search usernames…" autoFocus/><button className="primary-button" disabled={searchingPeople}>{searchingPeople ? 'Searching' : 'Search'}</button></form><div className="people-results">{peopleResults.length ? peopleResults.map((person) => <div className="person-result" key={person.id}><div className="avatar">{initials(person.username)}</div><div className="person-result-copy"><strong>@{person.username}</strong><span>Guest member</span></div><button className="secondary-button" onClick={() => void openDM(person)}><MessageCircle size={15}/> Message</button></div>) : <div className="people-empty"><div className="empty-chat-orb"><UserRound size={22}/></div><strong>Find your people</strong><span>Search for at least 3 characters. Exact usernames work best.</span></div>}</div><div className="modal-note"><Shield size={14}/> Private messages are visible only to conversation participants.</div></section></div>}
    {showReports && isModerator && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowReports(false); }}><section className="people-modal glass reports-modal" role="dialog" aria-modal="true" aria-labelledby="reports-title"><div className="modal-heading"><div><div className="eyebrow">MODERATOR TOOLS</div><h2 id="reports-title">Open reports</h2><p>Review flagged messages and decide whether to dismiss or mark them reviewed.</p></div><button className="icon-button" aria-label="Close" onClick={() => setShowReports(false)}><X size={18}/></button></div><div className="report-list">{reports.length ? reports.map((report) => <article className="report-card" key={report.id}><div className="report-card-top"><strong>{report.profiles?.username ? `@${report.profiles.username}` : 'Message'}</strong><time>{timeLabel(report.created_at)}</time></div><p className="report-quote">{report.reported_body || '[Image message]'}</p><p className="report-reason"><strong>Reason:</strong> {report.reason}</p><div className="report-actions"><button className="secondary-button" onClick={() => void updateReport(report.id, 'dismissed')}>Dismiss</button><button className="primary-button" onClick={() => void updateReport(report.id, 'reviewed')}><Check size={14}/> Mark reviewed</button></div></article>) : <div className="people-empty"><div className="empty-chat-orb"><Shield size={22}/></div><strong>You're all caught up</strong><span>No open reports right now.</span></div>}</div></section></div>}
  </div>;
}

function SetupScreen() {
  return <div className="setup-screen"><div className="setup-screen-card glass"><div className="brand-lockup"><div className="brand-mark"><Sparkles size={22}/></div><span>NEXUS<span className="brand-light"> CHAT</span></span></div><div className="eyebrow">ONE QUICK SETUP</div><h1>Connect your backend.</h1><p className="muted">The interface is ready. Add your Supabase project keys to turn on real chat, guest sessions, message history, image uploads and online status.</p><ol className="setup-steps"><li><span>1</span><div><strong>Create a Supabase project</strong><p>Use the free tier at <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a>.</p></div></li><li><span>2</span><div><strong>Run the database setup</strong><p>Open SQL Editor and run <code>supabase/schema.sql</code> from this project.</p></div></li><li><span>3</span><div><strong>Add your environment file</strong><p>Copy <code>.env.example</code> to <code>.env</code> and fill in your project URL and publishable/anon key.</p></div></li><li><span>4</span><div><strong>Start the website</strong><p>Run <code>npm install</code> then <code>npm run dev</code>.</p></div></li></ol><div className="setup-warning"><Shield size={17}/><span>Never put your Supabase service-role key in the frontend. This app uses the public client key and relies on database policies for access control.</span></div></div></div>;
}
