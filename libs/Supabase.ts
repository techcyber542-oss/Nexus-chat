
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://iveomgpuiygsgrkxfbvl.supabase.co'
const supabaseAnonKey = 'sb_publishable_HlXDf6OzXcn64P0ZpOpD7Q_hDBbcWrU'

export const hasSupabaseConfig = Boolean(
  supabaseUrl && supabaseAnonKey
)

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
)
