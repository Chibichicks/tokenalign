// Enhanced tax-specific extraction from LinkedIn Jobs
const jobList = [];
const jobElements = document.querySelectorAll('li');

jobElements.forEach(element => {
    try {
        const title = element.querySelector('h3');
        const company = element.querySelector('h4');
        const date = element.querySelector('time');
        const link = element.querySelector('a');
        
        if (title && company) {
            const jobData = {
                title: title.textContent.trim(),
                company: company.textContent.trim(),
                date: date?.textContent?.trim() || 'Recent',
                source: 'LinkedIn',
                location: 'Singapore',
                url: link?.href || ''
            };
            
            // Enhanced tax filtering for specific target roles
            const targetRoles = [
                'Tax Director', 'Tax Manager', 'Senior Tax Analyst', 'Tax Specialist', 
                'Tax Consultant', 'Tax Compliance Manager', 'Transfer Pricing Specialist',
                'International Tax Manager', 'Tax Technology Manager', 'GST/VAT Specialist',
                'Tax Advisory Manager', 'Tax Reporting Manager', 'Tax Planning Manager',
                'Employment Tax Manager', 'Tax Operations Manager', 'BEPS COE Assistant Manager',
                'BEPS COE Senior Manager'
            ];
            
            const isTargetRole = targetRoles.some(role => 
                jobData.title.toLowerCase().includes(role.toLowerCase())
            );
            
            if (isTargetRole) {
                jobList.push(jobData);
            }
        }
    } catch (error) {
        // Silently handle malformed elements
        console.debug('Error processing job element:', error);
    }
});

console.log('Extracted tax jobs:', jobList.length);
console.log('Jobs:', jobList.slice(0, 10)); // Show first 10 for preview
return jobList.slice(0, 50); // Return first 50 for performance
