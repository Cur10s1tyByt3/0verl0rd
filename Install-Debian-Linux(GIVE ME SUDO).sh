sudo apt remove $(dpkg --get-selections docker.io docker-compose docker-doc podman-docker containerd runc | cut -f1)
# Add Docker's official GPG key:
sudo apt-get update -y
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
sudo tee /etc/apt/sources.list.d/docker.sources
#Types: deb
#URIs: https://download.docker.com/linux/debian
#Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
#Components: stable
#Signed-By: /etc/apt/keyrings/docker.asc

sudo apt-get update -y

# Add Docker's official GPG key:
sudo apt-get update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
sudo tee /etc/apt/sources.list.d/docker.sources 
#Types: deb
#URIs: https://download.docker.com/linux/debian
#Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
#Components: stable
#Signed-By: /etc/apt/keyrings/docker.asc

sudo apt-get update -y

sudo systemctl status docker

sudo systemctl start docker
