export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      company_ai_reports: {
        Row: {
          created_at: string
          financial_score: number
          generated_at: string
          growth_score: number
          ico: string
          id: string
          overall_score: number
          public_score: number
          recommendation: string
          strengths: Json
          summary: string
          updated_at: string
          warnings: Json
          weaknesses: Json
        }
        Insert: {
          created_at?: string
          financial_score: number
          generated_at?: string
          growth_score: number
          ico: string
          id?: string
          overall_score: number
          public_score: number
          recommendation: string
          strengths?: Json
          summary: string
          updated_at?: string
          warnings?: Json
          weaknesses?: Json
        }
        Update: {
          created_at?: string
          financial_score?: number
          generated_at?: string
          growth_score?: number
          ico?: string
          id?: string
          overall_score?: number
          public_score?: number
          recommendation?: string
          strengths?: Json
          summary?: string
          updated_at?: string
          warnings?: Json
          weaknesses?: Json
        }
        Relationships: []
      }
      company_cache: {
        Row: {
          data: Json
          fetched_at: string
          ico: string
          updated_at: string
        }
        Insert: {
          data: Json
          fetched_at?: string
          ico: string
          updated_at?: string
        }
        Update: {
          data?: Json
          fetched_at?: string
          ico?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_changes: {
        Row: {
          change_type: string
          description: string | null
          detected_at: string
          ico: string
          id: string
          severity: string
          title: string
        }
        Insert: {
          change_type: string
          description?: string | null
          detected_at?: string
          ico: string
          id?: string
          severity?: string
          title: string
        }
        Update: {
          change_type?: string
          description?: string | null
          detected_at?: string
          ico?: string
          id?: string
          severity?: string
          title?: string
        }
        Relationships: []
      }
      company_history: {
        Row: {
          created_at: string
          description: string | null
          event_date: string | null
          event_type: string
          ico: string
          id: string
          imported_at: string
          source: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_date?: string | null
          event_type: string
          ico: string
          id?: string
          imported_at?: string
          source?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          event_date?: string | null
          event_type?: string
          ico?: string
          id?: string
          imported_at?: string
          source?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_insurance_debts: {
        Row: {
          address: string | null
          currency: string | null
          debt_amount: number | null
          debtor_found: boolean
          debtor_name: string | null
          first_seen_at: string
          ico: string
          id: string
          imported_at: string
          is_current: boolean
          last_seen_at: string
          provider: string
          raw_data: Json | null
          removed_at: string | null
          source_import_run_id: string | null
          source_record_date: string | null
          source_record_hash: string | null
          source_url: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          address?: string | null
          currency?: string | null
          debt_amount?: number | null
          debtor_found: boolean
          debtor_name?: string | null
          first_seen_at?: string
          ico: string
          id?: string
          imported_at?: string
          is_current?: boolean
          last_seen_at?: string
          provider: string
          raw_data?: Json | null
          removed_at?: string | null
          source_import_run_id?: string | null
          source_record_date?: string | null
          source_record_hash?: string | null
          source_url?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          address?: string | null
          currency?: string | null
          debt_amount?: number | null
          debtor_found?: boolean
          debtor_name?: string | null
          first_seen_at?: string
          ico?: string
          id?: string
          imported_at?: string
          is_current?: boolean
          last_seen_at?: string
          provider?: string
          raw_data?: Json | null
          removed_at?: string | null
          source_import_run_id?: string | null
          source_record_date?: string | null
          source_record_hash?: string | null
          source_url?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
      company_match_keys: {
        Row: {
          ico: string
          name_normalized: string | null
          obec: string | null
          psc: string | null
          updated_at: string
        }
        Insert: {
          ico: string
          name_normalized?: string | null
          obec?: string | null
          psc?: string | null
          updated_at?: string
        }
        Update: {
          ico?: string
          name_normalized?: string | null
          obec?: string | null
          psc?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      company_people: {
        Row: {
          created_at: string
          ico: string
          id: string
          imported_at: string
          person_name: string
          role: string
          source: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          ico: string
          id?: string
          imported_at?: string
          person_name: string
          role: string
          source?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          ico?: string
          id?: string
          imported_at?: string
          person_name?: string
          role?: string
          source?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      company_persons: {
        Row: {
          address: string | null
          birth_date: string | null
          created_at: string
          first_seen_at: string
          full_name: string
          function_label: string | null
          ico: string
          id: string
          is_current: boolean
          last_seen_at: string
          person_type: string
          raw_data: Json | null
          removed_at: string | null
          share_amount: number | null
          share_currency: string | null
          share_percent: number | null
          source: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          created_at?: string
          first_seen_at?: string
          full_name: string
          function_label?: string | null
          ico: string
          id?: string
          is_current?: boolean
          last_seen_at?: string
          person_type: string
          raw_data?: Json | null
          removed_at?: string | null
          share_amount?: number | null
          share_currency?: string | null
          share_percent?: number | null
          source?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          created_at?: string
          first_seen_at?: string
          full_name?: string
          function_label?: string | null
          ico?: string
          id?: string
          is_current?: boolean
          last_seen_at?: string
          person_type?: string
          raw_data?: Json | null
          removed_at?: string | null
          share_amount?: number | null
          share_currency?: string | null
          share_percent?: number | null
          source?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      company_registry: {
        Row: {
          address: string | null
          created_at: string
          first_seen_at: string | null
          ico: string
          id: string
          imported_at: string
          is_current: boolean
          last_seen_at: string | null
          legal_form: string | null
          name: string | null
          name_normalized: string | null
          obec: string | null
          obec_normalized: string | null
          psc: string | null
          registration_date: string | null
          registration_number: string | null
          removed_at: string | null
          source: string
          source_record_hash: string | null
          status: string | null
          street: string | null
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          first_seen_at?: string | null
          ico: string
          id?: string
          imported_at?: string
          is_current?: boolean
          last_seen_at?: string | null
          legal_form?: string | null
          name?: string | null
          name_normalized?: string | null
          obec?: string | null
          obec_normalized?: string | null
          psc?: string | null
          registration_date?: string | null
          registration_number?: string | null
          removed_at?: string | null
          source?: string
          source_record_hash?: string | null
          status?: string | null
          street?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          first_seen_at?: string | null
          ico?: string
          id?: string
          imported_at?: string
          is_current?: boolean
          last_seen_at?: string | null
          legal_form?: string | null
          name?: string | null
          name_normalized?: string | null
          obec?: string | null
          obec_normalized?: string | null
          psc?: string | null
          registration_date?: string | null
          registration_number?: string | null
          removed_at?: string | null
          source?: string
          source_record_hash?: string | null
          status?: string | null
          street?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      company_registry_history: {
        Row: {
          change_type: string
          created_at: string
          effective_date: string | null
          field_label: string | null
          first_seen_at: string
          ico: string
          id: string
          is_current: boolean
          new_value: string | null
          old_value: string | null
          source: string
          updated_at: string
        }
        Insert: {
          change_type: string
          created_at?: string
          effective_date?: string | null
          field_label?: string | null
          first_seen_at?: string
          ico: string
          id?: string
          is_current?: boolean
          new_value?: string | null
          old_value?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          change_type?: string
          created_at?: string
          effective_date?: string | null
          field_label?: string | null
          first_seen_at?: string
          ico?: string
          id?: string
          is_current?: boolean
          new_value?: string | null
          old_value?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_snapshots: {
        Row: {
          created_at: string
          data: Json
          ico: string
          id: string
        }
        Insert: {
          created_at?: string
          data: Json
          ico: string
          id?: string
        }
        Update: {
          created_at?: string
          data?: Json
          ico?: string
          id?: string
        }
        Relationships: []
      }
      company_tax_debts: {
        Row: {
          amount: number | null
          created_at: string
          debtor_address_raw: string | null
          debtor_name_raw: string | null
          first_seen_at: string
          ico: string
          id: string
          is_current: boolean
          last_seen_at: string
          match_confidence: number | null
          match_tier: string
          removed_at: string | null
          source: string
          source_record_date: string | null
          source_record_hash: string | null
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          debtor_address_raw?: string | null
          debtor_name_raw?: string | null
          first_seen_at?: string
          ico: string
          id?: string
          is_current?: boolean
          last_seen_at?: string
          match_confidence?: number | null
          match_tier: string
          removed_at?: string | null
          source?: string
          source_record_date?: string | null
          source_record_hash?: string | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          debtor_address_raw?: string | null
          debtor_name_raw?: string | null
          first_seen_at?: string
          ico?: string
          id?: string
          is_current?: boolean
          last_seen_at?: string
          match_confidence?: number | null
          match_tier?: string
          removed_at?: string | null
          source?: string
          source_record_date?: string | null
          source_record_hash?: string | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
      company_tax_status: {
        Row: {
          first_seen_at: string
          ic_dph: string | null
          ico: string
          id: string
          imported_at: string
          is_current: boolean
          last_seen_at: string
          raw_data: Json | null
          removed_at: string | null
          source_dataset: string | null
          source_import_run_id: string | null
          source_record_date: string | null
          source_record_hash: string | null
          source_url: string | null
          tax_debt_amount: number | null
          tax_debtor_found: boolean | null
          tax_reliability_index: string | null
          valid_from: string
          valid_to: string | null
          vat_registered: boolean | null
          vat_registration_date: string | null
        }
        Insert: {
          first_seen_at?: string
          ic_dph?: string | null
          ico: string
          id?: string
          imported_at?: string
          is_current?: boolean
          last_seen_at?: string
          raw_data?: Json | null
          removed_at?: string | null
          source_dataset?: string | null
          source_import_run_id?: string | null
          source_record_date?: string | null
          source_record_hash?: string | null
          source_url?: string | null
          tax_debt_amount?: number | null
          tax_debtor_found?: boolean | null
          tax_reliability_index?: string | null
          valid_from?: string
          valid_to?: string | null
          vat_registered?: boolean | null
          vat_registration_date?: string | null
        }
        Update: {
          first_seen_at?: string
          ic_dph?: string | null
          ico?: string
          id?: string
          imported_at?: string
          is_current?: boolean
          last_seen_at?: string
          raw_data?: Json | null
          removed_at?: string | null
          source_dataset?: string | null
          source_import_run_id?: string | null
          source_record_date?: string | null
          source_record_hash?: string | null
          source_url?: string | null
          tax_debt_amount?: number | null
          tax_debtor_found?: boolean | null
          tax_reliability_index?: string | null
          valid_from?: string
          valid_to?: string | null
          vat_registered?: boolean | null
          vat_registration_date?: string | null
        }
        Relationships: []
      }
      data_freshness: {
        Row: {
          created_at: string
          error_message: string | null
          ico: string
          id: string
          last_attempt_at: string | null
          last_success_at: string | null
          source: string
          status: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          ico: string
          id?: string
          last_attempt_at?: string | null
          last_success_at?: string | null
          source: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          ico?: string
          id?: string
          last_attempt_at?: string | null
          last_success_at?: string | null
          source?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      datahub_import_progress: {
        Row: {
          current_batch: number | null
          id: string
          message: string | null
          phase: string
          records_processed: number | null
          records_total: number | null
          run_id: string
          source: string
          total_batches: number | null
          updated_at: string
        }
        Insert: {
          current_batch?: number | null
          id?: string
          message?: string | null
          phase: string
          records_processed?: number | null
          records_total?: number | null
          run_id: string
          source: string
          total_batches?: number | null
          updated_at?: string
        }
        Update: {
          current_batch?: number | null
          id?: string
          message?: string | null
          phase?: string
          records_processed?: number | null
          records_total?: number | null
          run_id?: string
          source?: string
          total_batches?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      datahub_settings: {
        Row: {
          cron_secret: string | null
          global_import_current_run_id: string | null
          global_import_last_finished_at: string | null
          global_import_running: boolean
          global_import_started_at: string | null
          id: boolean
          updated_at: string
          updated_by: string | null
          worker_paused: boolean
        }
        Insert: {
          cron_secret?: string | null
          global_import_current_run_id?: string | null
          global_import_last_finished_at?: string | null
          global_import_running?: boolean
          global_import_started_at?: string | null
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          worker_paused?: boolean
        }
        Update: {
          cron_secret?: string | null
          global_import_current_run_id?: string | null
          global_import_last_finished_at?: string | null
          global_import_running?: boolean
          global_import_started_at?: string | null
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          worker_paused?: boolean
        }
        Relationships: []
      }
      datahub_worker_runs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          failed: number
          finished_at: string | null
          id: string
          paused: boolean
          processed: number
          skipped: number
          started_at: string
          successful: number
          trigger_source: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          paused?: boolean
          processed?: number
          skipped?: number
          started_at?: string
          successful?: number
          trigger_source?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          paused?: boolean
          processed?: number
          skipped?: number
          started_at?: string
          successful?: number
          trigger_source?: string
        }
        Relationships: []
      }
      import_logs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          ico: string
          id: string
          records_count: number
          source: string
          started_at: string
          status: string
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          ico: string
          id?: string
          records_count?: number
          source: string
          started_at?: string
          status: string
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          ico?: string
          id?: string
          records_count?: number
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      import_queue: {
        Row: {
          attempts: number
          created_at: string
          finished_at: string | null
          force_refresh: boolean
          ico: string
          id: string
          last_error: string | null
          priority: number
          source: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          force_refresh?: boolean
          ico: string
          id?: string
          last_error?: string | null
          priority?: number
          source: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          force_refresh?: boolean
          ico?: string
          id?: string
          last_error?: string | null
          priority?: number
          source?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      insurance_import_runs: {
        Row: {
          content_hash: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          previous_source_hash: string | null
          provider: string
          records_deactivated: number
          records_downloaded: number | null
          records_inserted: number
          records_invalid: number
          records_normalized: number | null
          records_unchanged: number
          records_updated: number
          records_valid: number
          records_with_ico: number | null
          source_record_date: string | null
          source_url: string | null
          started_at: string
          status: string
          validation_status: string | null
        }
        Insert: {
          content_hash?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          previous_source_hash?: string | null
          provider: string
          records_deactivated?: number
          records_downloaded?: number | null
          records_inserted?: number
          records_invalid?: number
          records_normalized?: number | null
          records_unchanged?: number
          records_updated?: number
          records_valid?: number
          records_with_ico?: number | null
          source_record_date?: string | null
          source_url?: string | null
          started_at?: string
          status: string
          validation_status?: string | null
        }
        Update: {
          content_hash?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          previous_source_hash?: string | null
          provider?: string
          records_deactivated?: number
          records_downloaded?: number | null
          records_inserted?: number
          records_invalid?: number
          records_normalized?: number | null
          records_unchanged?: number
          records_updated?: number
          records_valid?: number
          records_with_ico?: number | null
          source_record_date?: string | null
          source_url?: string | null
          started_at?: string
          status?: string
          validation_status?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          company_name: string | null
          created_at: string
          email: string | null
          id: string
          plan: string
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          id: string
          plan?: string
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          plan?: string
          updated_at?: string
        }
        Relationships: []
      }
      recent_searches: {
        Row: {
          company_name: string | null
          created_at: string
          ico: string | null
          id: string
          query: string
          user_id: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          ico?: string | null
          id?: string
          query: string
          user_id: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          ico?: string | null
          id?: string
          query?: string
          user_id?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          company_name: string
          created_at: string
          ico: string
          id: string
          report_type: string
          user_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          ico: string
          id?: string
          report_type?: string
          user_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          ico?: string
          id?: string
          report_type?: string
          user_id?: string
        }
        Relationships: []
      }
      staging_insurance_debts: {
        Row: {
          address: string | null
          currency: string | null
          debt_amount: number | null
          debtor_name: string | null
          ico: string
          provider: string
          raw_data: Json | null
          run_id: string
          source_record_hash: string
          source_url: string | null
        }
        Insert: {
          address?: string | null
          currency?: string | null
          debt_amount?: number | null
          debtor_name?: string | null
          ico: string
          provider: string
          raw_data?: Json | null
          run_id: string
          source_record_hash: string
          source_url?: string | null
        }
        Update: {
          address?: string | null
          currency?: string | null
          debt_amount?: number | null
          debtor_name?: string | null
          ico?: string
          provider?: string
          raw_data?: Json | null
          run_id?: string
          source_record_hash?: string
          source_url?: string | null
        }
        Relationships: []
      }
      staging_tax_records: {
        Row: {
          dataset: string
          ic_dph: string | null
          ico: string
          raw_data: Json | null
          run_id: string
          source_record_hash: string
          source_url: string | null
          tax_debt_amount: number | null
          tax_debtor_found: boolean | null
          tax_reliability_index: string | null
          vat_registered: boolean | null
          vat_registration_date: string | null
        }
        Insert: {
          dataset: string
          ic_dph?: string | null
          ico: string
          raw_data?: Json | null
          run_id: string
          source_record_hash: string
          source_url?: string | null
          tax_debt_amount?: number | null
          tax_debtor_found?: boolean | null
          tax_reliability_index?: string | null
          vat_registered?: boolean | null
          vat_registration_date?: string | null
        }
        Update: {
          dataset?: string
          ic_dph?: string | null
          ico?: string
          raw_data?: Json | null
          run_id?: string
          source_record_hash?: string
          source_url?: string | null
          tax_debt_amount?: number | null
          tax_debtor_found?: boolean | null
          tax_reliability_index?: string | null
          vat_registered?: boolean | null
          vat_registration_date?: string | null
        }
        Relationships: []
      }
      tax_debtor_manual_mappings: {
        Row: {
          created_at: string
          created_by: string | null
          ico: string
          id: string
          name_normalized: string
          psc: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ico: string
          id?: string
          name_normalized: string
          psc: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ico?: string
          id?: string
          name_normalized?: string
          psc?: string
        }
        Relationships: []
      }
      tax_debtor_unmatched: {
        Row: {
          address_raw: string | null
          amount: number | null
          candidates: Json
          created_at: string
          debtor_name_normalized: string | null
          debtor_name_raw: string
          id: string
          matched_ico: string | null
          obec: string | null
          psc: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string | null
          source_record_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address_raw?: string | null
          amount?: number | null
          candidates?: Json
          created_at?: string
          debtor_name_normalized?: string | null
          debtor_name_raw: string
          id?: string
          matched_ico?: string | null
          obec?: string | null
          psc?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          source_record_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address_raw?: string | null
          amount?: number | null
          candidates?: Json
          created_at?: string
          debtor_name_normalized?: string | null
          debtor_name_raw?: string
          id?: string
          matched_ico?: string | null
          obec?: string | null
          psc?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          source_record_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      tax_import_runs: {
        Row: {
          content_hash: string | null
          dataset: string
          error_message: string | null
          finished_at: string | null
          id: string
          previous_source_hash: string | null
          records_deactivated: number
          records_downloaded: number
          records_inserted: number
          records_invalid: number
          records_normalized: number
          records_unchanged: number
          records_updated: number
          records_valid: number
          records_with_valid_ico: number
          source_record_date: string | null
          source_url: string | null
          started_at: string
          status: string
          validation_status: string | null
        }
        Insert: {
          content_hash?: string | null
          dataset: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          previous_source_hash?: string | null
          records_deactivated?: number
          records_downloaded?: number
          records_inserted?: number
          records_invalid?: number
          records_normalized?: number
          records_unchanged?: number
          records_updated?: number
          records_valid?: number
          records_with_valid_ico?: number
          source_record_date?: string | null
          source_url?: string | null
          started_at?: string
          status: string
          validation_status?: string | null
        }
        Update: {
          content_hash?: string | null
          dataset?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          previous_source_hash?: string | null
          records_deactivated?: number
          records_downloaded?: number
          records_inserted?: number
          records_invalid?: number
          records_normalized?: number
          records_unchanged?: number
          records_updated?: number
          records_valid?: number
          records_with_valid_ico?: number
          source_record_date?: string | null
          source_url?: string | null
          started_at?: string
          status?: string
          validation_status?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      watched_companies: {
        Row: {
          company_name: string
          created_at: string
          ico: string
          id: string
          risk_score: number | null
          user_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          ico: string
          id?: string
          risk_score?: number | null
          user_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          ico?: string
          id?: string
          risk_score?: number | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_cron_jobs: {
        Args: never
        Returns: {
          active: boolean
          jobname: string
          last_end_time: string
          last_start_time: string
          last_status: string
          schedule: string
        }[]
      }
      close_removed_insurance_debt_keys: {
        Args: { _icos: string[]; _provider: string }
        Returns: number
      }
      close_removed_registry_keys: {
        Args: { _icos: string[]; _source: string }
        Returns: number
      }
      close_removed_tax_debt_keys: {
        Args: { _icos: string[]; _source: string }
        Returns: number
      }
      close_removed_tax_status_keys: {
        Args: { _dataset: string; _icos: string[] }
        Returns: number
      }
      extract_obec: { Args: { input: string }; Returns: string }
      extract_psc: { Args: { input: string }; Returns: string }
      find_tax_debtor_candidates: {
        Args: {
          _limit?: number
          _name_normalized: string
          _obec: string
          _psc: string
        }
        Returns: {
          ico: string
          name_normalized: string
          obec: string
          psc: string
          sim: number
        }[]
      }
      get_scheduler_status: {
        Args: never
        Returns: {
          active: boolean
          jobname: string
          last_error: string
          last_run_start: string
          last_run_status: string
          schedule: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      normalize_company_name: { Args: { input: string }; Returns: string }
      normalize_text: { Args: { input: string }; Returns: string }
      reconcile_insurance_cleanup: {
        Args: { _run_id: string }
        Returns: undefined
      }
      reconcile_insurance_deactivate_batch: {
        Args: {
          _after_ico: string
          _limit: number
          _provider: string
          _run_id: string
        }
        Returns: {
          deactivated: number
          last_ico: string
          scanned: number
        }[]
      }
      reconcile_insurance_debts: {
        Args: { _provider: string; _run_id: string; _source_date: string }
        Returns: {
          deactivated: number
          inserted: number
          unchanged: number
          updated: number
        }[]
      }
      reconcile_insurance_debts_batch: {
        Args: {
          _after_ico: string
          _limit: number
          _provider: string
          _run_id: string
          _source_date: string
        }
        Returns: {
          inserted: number
          last_ico: string
          processed: number
          unchanged: number
          updated: number
        }[]
      }
      reconcile_tax_dataset: {
        Args: { _dataset: string; _run_id: string; _source_date: string }
        Returns: {
          deactivated: number
          inserted: number
          unchanged: number
          updated: number
        }[]
      }
      reconcile_tax_dataset_batch: {
        Args: {
          _after_ico: string
          _dataset: string
          _limit: number
          _run_id: string
          _source_date: string
        }
        Returns: {
          inserted: number
          last_ico: string
          processed: number
          unchanged: number
          updated: number
        }[]
      }
      reconcile_tax_dataset_cleanup: {
        Args: { _run_id: string }
        Returns: undefined
      }
      reconcile_tax_dataset_deactivate_batch: {
        Args: {
          _after_ico: string
          _dataset: string
          _limit: number
          _run_id: string
        }
        Returns: {
          deactivated: number
          last_ico: string
          scanned: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
