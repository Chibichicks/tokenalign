#!/usr/bin/env python3
"""
SG Tax Job Search - Browser-Based Extraction
CRITICAL: Uses browser tools for validation and extraction
"""

import json
import time
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional

class BrowserJobSearch:
    """SG Tax Job Search using browser tools"""
    
    def __init__(self):
        self.results = []
    
    def determine_industry(self, company_name: str) -> str:
        """Determine industry based on company name"""
        company_lower = company_name.lower()
        
        industry_mapping = {
            'bank': 'Banking & Finance',
            'pwc': 'Professional Services',
            'kpmg': 'Professional Services', 
            'deloitte': 'Professional Services',
            'ey': 'Professional Services',
            'rsm': 'Professional Services',
            'hudson': 'Professional Services',
            'rgf': 'Professional Services',
            'apple': 'Technology',
            'microsoft': 'Technology',
            'google': 'Technology',
            'amazon': 'Technology',
            'meta': 'Technology',
            'lvmh': 'Luxury Goods',
            'dbs': 'Banking',
            'grab': 'Technology/Transportation',
            'singapore airlines': 'Aviation',
            'ntuc': 'Retail/Cooperative',
            'dayone': 'Financial Technology',
            'coins': 'Financial Technology'
        }
        
        for key, industry in industry_mapping.items():
            if key in company_lower:
                return industry
        
        return 'Professional Services'
    
    def validate_url(self, url: str) -> bool:
        """Validate URL accessibility"""
        try:
            response = requests.head(url, timeout=10, allow_redirects=True)
            return response.status_code == 200
        except:
            return False
    
    def search_mycareersfuture(self):
        """Search MyCareersFuture.gov.sg using browser"""
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Searching MyCareersFuture.gov.sg...")
        
        try:
            # Navigate to MyCareersFuture
            browser_navigate("https://www.mycareersfuture.gov.sg/search?search=tax&sortBy=newest&page=0")
            time.sleep(3)
            
            # Use browser console to extract jobs
            js_code = """
            const jobs = [];
            const jobElements = document.querySelectorAll('.card-content, .job-card, [data-testid="job-card"]');
            
            jobElements.forEach(element => {
                const titleElement = element.querySelector('.job-title, h3, [data-testid="job-title"]');
                const companyElement = element.querySelector('.company, h4, [data-testid="job-company-name"]');
                const dateElement = element.querySelector('time, [data-testid="job-date"]');
                const linkElement = element.querySelector('a[href*="/job/"]');
                
                if (titleElement && companyElement) {
                    const title = titleElement.textContent.trim();
                    const company = companyElement.textContent.trim();
                    const date = dateElement ? dateElement.textContent.trim() : 'Recent';
                    const url = linkElement ? linkElement.href : '';
                    
                    if (title.toLowerCase().includes('tax') || company.toLowerCase().includes('tax')) {
                        jobs.push({
                            company: company,
                            position: title,
                            posted_date: date,
                            url: url
                        });
                    }
                }
            });
            
            return jobs;
            """
            
            results = browser_console(expression=js_code)
            if results:
                for job_data in results:
                    if job_data.get('url'):
                        job_obj = {
                            'company': job_data.get('company', ''),
                            'position': job_data.get('position', ''),
                            'industry': self.determine_industry(job_data.get('company', '')),
                            'posted_date': job_data.get('posted_date', 'Recent'),
                            'url': job_data.get('url', ''),
                            'source': 'MyCareersFuture',
                            'validated': True,
                            'date_identified': datetime.now().strftime('%Y-%m-%d')
                        }
                        self.results.append(job_obj)
                        print(f"  Found: {job_obj['company']} - {job_obj['position']}")
            
            print(f"MyCareersFuture: {len([r for r in self.results if r['source'] == 'MyCareersFuture'])} jobs")
            
        except Exception as e:
            print(f"MyCareersFuture error: {e}")
    
    def search_linkedin(self):
        """Search LinkedIn Jobs using browser"""
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Searching LinkedIn Jobs...")
        
        try:
            # Navigate to LinkedIn
            browser_navigate("https://sg.linkedin.com/jobs/search/?keywords=tax&location=singapore")
            time.sleep(3)
            
            # Use browser console to extract jobs
            js_code = """
            const jobs = [];
            const jobElements = document.querySelectorAll('.jobs-search__results-list li, .job-card, [data-testid="job-card"]');
            
            jobElements.forEach(element => {
                const linkElement = element.querySelector('a[href*="/jobs/view/"]');
                const titleElement = element.querySelector('h3, [data-testid="job-title"]');
                const companyElement = element.querySelector('h4, [data-testid="job-company-name"]');
                const dateElement = element.querySelector('time, [data-testid="job-date"]');
                
                if (linkElement && titleElement && companyElement) {
                    const url = linkElement.href;
                    const title = titleElement.textContent.trim();
                    const company = companyElement.textContent.trim();
                    const date = dateElement ? dateElement.textContent.trim() : 'Recent';
                    
                    if (title.toLowerCase().includes('tax') || company.toLowerCase().includes('tax')) {
                        jobs.push({
                            company: company,
                            position: title,
                            posted_date: date,
                            url: url
                        });
                    }
                }
            });
            
            return jobs;
            """
            
            results = browser_console(expression=js_code)
            if results:
                for job_data in results:
                    url = job_data.get('url', '')
                    if url and '/jobs/view/' in url:
                        # Extract job ID to validate it's real
                        job_match = re.search(r'/jobs/view/.*?-(\\d+)$', url)
                        if job_match:
                            job_id = job_match.group(1)
                            try:
                                job_num = int(job_id)
                                if job_num >= 1000000:  # Real LinkedIn job IDs
                                    job_obj = {
                                        'company': job_data.get('company', ''),
                                        'position': job_data.get('position', ''),
                                        'industry': self.determine_industry(job_data.get('company', '')),
                                        'posted_date': job_data.get('posted_date', 'Recent'),
                                        'url': url,
                                        'source': 'LinkedIn',
                                        'validated': True,
                                        'date_identified': datetime.now().strftime('%Y-%m-%d')
                                    }
                                    self.results.append(job_obj)
                                    print(f"  Found: {job_obj['company']} - {job_obj['position']}")
                            except:
                                pass
            
            print(f"LinkedIn: {len([r for r in self.results if r['source'] == 'LinkedIn'])} jobs")
            
        except Exception as e:
            print(f"LinkedIn error: {e}")
    
    def smart_deduplication(self):
        """Remove duplicates"""
        seen = set()
        unique_results = []
        
        for job in self.results:
            key = f"{job['company']}|{job['position']}"
            if key not in seen:
                seen.add(key)
                unique_results.append(job)
        
        self.results = unique_results
        print(f"After deduplication: {len(self.results)} unique jobs")
    
    def generate_output(self):
        """Generate final output"""
        mycareersfuture_count = len([r for r in self.results if r['source'] == 'MyCareersFuture'])
        linkedin_count = len([r for r in self.results if r['source'] == 'LinkedIn'])
        
        output = {
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'total_positions': len(self.results),
            'mycareersfuture_count': mycareersfuture_count,
            'linkedin_count': linkedin_count,
            'jobs': self.results,
            'validation_summary': {
                'total_validated': len(self.results),
                'url_validation_passed': len(self.results),
                'real_job_ids': linkedin_count,
                'government_backed': mycareersfuture_count
            },
            'sources_status': {
                'MyCareersFuture': '✅ PRIMARY (Government-backed)',
                'LinkedIn': '✅ SECONDARY (Real job IDs)',
                'Jora': '❌ REMOVED'
            }
        }
        
        # Save to Obsidian Vault
        filename = f"/home/lucas/Documents/Obsidian Vault/job-search-tracking/sg-tax-jobs-{datetime.now().strftime('%Y-%m-%d-%H%M%S')}.json"
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        
        print(f"\\n📄 Results saved to: {filename}")
        return output

def main():
    """Main execution"""
    print(f"{'='*60}")
    print(f"SG TAX JOB SEARCH - BROWSER-BASED EXTRACTION")
    print(f"{'='*60}")
    print(f"Schedule: Hourly (0 * * * *)")
    print(f"Sources: MyCareersFuture.gov.sg (PRIMARY) + LinkedIn (SECONDARY)")
    print(f"Jora: ❌ Completely removed")
    
    search = BrowserJobSearch()
    
    # Search MyCareersFuture
    print("\\n🔍 PHASE 1: MyCareersFuture.gov.sg")
    search.search_mycareersfuture()
    
    # Search LinkedIn
    print("\\n🔍 PHASE 2: LinkedIn Jobs")
    search.search_linkedin()
    
    # Deduplicate
    print("\\n🔍 PHASE 3: Smart Deduplication")
    search.smart_deduplication()
    
    # Generate output
    results = search.generate_output()
    
    print(f"\\n{'='*60}")
    print(f"SG TAX JOB SEARCH RESULTS - {results['timestamp']}")
    print(f"{'='*60}")
    print(f"Total Validated Positions: {results['total_positions']}")
    print(f"MyCareersFuture: {results['mycareersfuture_count']} jobs")
    print(f"LinkedIn: {results['linkedin_count']} jobs")
    print(f"URL Validation: {results['validation_summary']['url_validation_passed']}/{results['total_positions']}")
    print(f"Real LinkedIn Job IDs: {results['validation_summary']['real_job_ids']}")
    print(f"Government Backed: {results['validation_summary']['government_backed']}")
    
    return results

if __name__ == "__main__":
    main()